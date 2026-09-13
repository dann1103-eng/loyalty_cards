import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import {
  crearPrograma,
  guardarConfiguracionPrograma,
  listarProgramas,
  type DatosNuevoPrograma,
} from '@/lib/comercio/programas';
import { textoAviso } from '@/lib/comercio/avisoVencimientoConfiguracion';

// El gate del dueño se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyComercioOwner. Mismo criterio que las pruebas de Reglas y del cartel.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { accionGuardarConfiguracionPrograma } = await import('./actions');
const { default: FormularioConfiguracionPrograma } = await import('./FormularioConfiguracionPrograma');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

// POR QUÉ ESTA PRUEBA DIBUJA EL FORMULARIO (mismo motivo que reglas/actions.test.ts): lo que protege
// vive en el PEGAMENTO entre el marcado y la acción. `guardarConfiguracionPrograma` escribe las tres
// columnas del aviso SIEMPRE, con lo que llegue en el FormData, y lo que no llega se guarda false/null.
// Una casilla sin `defaultChecked`, un campo con otro `name` que el que lee actions.ts, o un bloque
// que se dibuja con los campos deshabilitados, apagan el aviso en silencio la próxima vez que el
// dueño guarde CUALQUIER cosa. Un FormData armado a mano pasaría igual: por eso sale del HTML real.
//
// MUTACIONES verificadas:
//   - quitar `defaultChecked` de la casilla del aviso hace fallar "guardar otra cosa NO le toca el aviso";
//   - dibujar el bloque solo en membresía (y no por `usaVigencia`) hace fallar "un cupón también lo ofrece".

// Lo que el navegador enviaría al apretar Guardar: cada campo con nombre en orden de documento, las
// casillas solo si están marcadas, y del <textarea> su contenido. `cambios` es lo que el dueño tocó
// antes de guardar (un valor nuevo, o `false` para desmarcar una casilla).
function enviar(html: string, cambios: Record<string, string | false> = {}): FormData {
  const decodificar = (texto: string) =>
    texto
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const atributos = (etiqueta: string) => {
    const mapa = new Map<string, string>();
    for (const [, nombre, valor] of etiqueta.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      mapa.set(nombre, decodificar(valor ?? ''));
    }
    return mapa;
  };

  const fd = new FormData();
  for (const [bloque] of html.matchAll(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/g)) {
    const apertura = bloque.match(/^<\w+\b[^>]*>/)![0];
    const attrs = atributos(apertura.slice(apertura.indexOf(' ')));
    const nombre = attrs.get('name');
    if (!nombre || attrs.has('disabled')) continue;
    const cambio = cambios[nombre];

    if (bloque.startsWith('<textarea')) {
      const contenido = decodificar(bloque.slice(apertura.length, -'</textarea>'.length));
      fd.append(nombre, typeof cambio === 'string' ? cambio : contenido);
      continue;
    }

    if (attrs.get('type') === 'checkbox') {
      const marcada = cambio === undefined ? attrs.has('checked') : cambio !== false;
      if (marcada) fd.append(nombre, attrs.get('value') ?? 'on');
      continue;
    }

    fd.append(nombre, typeof cambio === 'string' ? cambio : (attrs.get('value') ?? ''));
  }
  return fd;
}

const FECHA_EJEMPLO = '2026-10-12';

// El programa como lo lee page.tsx (listarProgramas con los desactivados), y el formulario con las
// MISMAS props que le arma la página.
async function leerPrograma(comercioId: string, programaId: string) {
  const programas = await listarProgramas(supabase, comercioId, { soloActivos: false });
  const programa = programas?.find((p) => p.id === programaId);
  if (!programa) throw new Error('[test] no se pudo leer el programa');
  return programa;
}

async function dibujar(comercioId: string, programaId: string): Promise<string> {
  const programa = await leerPrograma(comercioId, programaId);
  return renderToStaticMarkup(
    createElement(FormularioConfiguracionPrograma, { programa, fechaEjemplo: FECHA_EJEMPLO }),
  );
}

function nuevo(tipoTarjeta: string, overrides: Partial<DatosNuevoPrograma> = {}): DatosNuevoPrograma {
  return {
    nombre: `Programa ${tipoTarjeta}`,
    tipoTarjeta,
    cashbackPorcentaje: null,
    multipassVisitas: null,
    membresiaDias: null,
    cuponVigenciaDias: null,
    ...overrides,
  };
}

async function crear(comercioId: string, datos: DatosNuevoPrograma): Promise<string> {
  const res = await crearPrograma(supabase, comercioId, datos);
  if (!res.ok) throw new Error(`[test] no se pudo crear el programa: ${res.error}`);
  return res.id;
}

// Una membresía de 30 días con el aviso ya configurado, guardado por el camino de producción.
async function membresiaConAviso(comercioId: string): Promise<string> {
  const programaId = await crear(comercioId, nuevo('membresia', { membresiaDias: 30 }));
  const res = await guardarConfiguracionPrograma(supabase, comercioId, programaId, {
    cashbackPorcentaje: null,
    multipassVisitas: null,
    membresiaDias: 30,
    cuponVigenciaDias: null,
    avisoVencimientoActivo: true,
    avisoVencimientoDias: 20,
    avisoVencimientoMensaje: 'Pasá a renovar, te esperamos',
  });
  if (!res.ok) throw new Error(`[test] no se pudo configurar el aviso: ${res.error}`);
  return programaId;
}

describe('FormularioConfiguracionPrograma — el aviso antes del vencimiento', () => {
  it('encenderlo desde el formulario lo guarda, y el formulario vuelto a dibujar lo muestra', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const programaId = await crear(comercioId, nuevo('membresia', { membresiaDias: 30 }));

    const html = await dibujar(comercioId, programaId);
    const res = await accionGuardarConfiguracionPrograma(
      programaId,
      undefined,
      enviar(html, {
        aviso_vencimiento_activo: 'on',
        aviso_vencimiento_dias: '5',
        aviso_vencimiento_mensaje: 'Pasá a renovar',
      }),
    );

    expect(res).toEqual({ ok: true });
    const programa = await leerPrograma(comercioId, programaId);
    expect(programa.avisoVencimientoActivo).toBe(true);
    expect(programa.avisoVencimientoDias).toBe(5);
    expect(programa.avisoVencimientoMensaje).toBe('Pasá a renovar');

    // Lo que ve el dueño al volver: la casilla marcada, los días y su mensaje, y la vista previa con
    // la fecha que agrega la app.
    const despues = await dibujar(comercioId, programaId);
    expect(despues).toMatch(/<input\b[^>]*name="aviso_vencimiento_activo"[^>]*checked/);
    expect(despues).toMatch(/<input\b[^>]*name="aviso_vencimiento_dias"[^>]*value="5"/);
    expect(despues).toMatch(/<textarea\b[^>]*name="aviso_vencimiento_mensaje"[^>]*>Pasá a renovar<\/textarea>/);
    expect(despues).toContain('Pasá a renovar. Vence el 12 de octubre de 2026.');
  });

  it('con el mensaje vacío, la vista previa muestra el texto por defecto del tipo con la fecha', async () => {
    const comercioId = await entorno.crearComercio();
    const programaId = await crear(comercioId, nuevo('membresia', { membresiaDias: 30 }));

    const html = await dibujar(comercioId, programaId);

    expect(html).toContain(textoAviso(null, 'membresia', FECHA_EJEMPLO));
    expect(html).toContain('Tu membresía está por vencer. Renovala en el local. Vence el 12 de octubre de 2026.');
  });

  it('guardar otra cosa NO le toca el aviso', async () => {
    // La mordida: el dueño entra a cambiar la duración de la membresía, aprieta Guardar, y el aviso
    // queda apagado sin que nadie lo haya decidido.
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const programaId = await membresiaConAviso(comercioId);

    const html = await dibujar(comercioId, programaId);
    const res = await accionGuardarConfiguracionPrograma(programaId, undefined, enviar(html, { membresia_dias: '45' }));

    expect(res).toEqual({ ok: true });
    const programa = await leerPrograma(comercioId, programaId);
    // La duración prueba que el guardado ocurrió de verdad: sin ella, una acción que no escribiera
    // nada dejaría el aviso intacto y la prueba pasaría por la razón equivocada.
    expect(programa.membresiaDias).toBe(45);
    expect(programa.avisoVencimientoActivo).toBe(true);
    expect(programa.avisoVencimientoDias).toBe(20);
    expect(programa.avisoVencimientoMensaje).toBe('Pasá a renovar, te esperamos');
  });

  it('apagar el interruptor conserva los días y el mensaje para cuando lo vuelva a encender', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const programaId = await membresiaConAviso(comercioId);

    const html = await dibujar(comercioId, programaId);
    const res = await accionGuardarConfiguracionPrograma(
      programaId,
      undefined,
      enviar(html, { aviso_vencimiento_activo: false }),
    );

    expect(res).toEqual({ ok: true });
    const programa = await leerPrograma(comercioId, programaId);
    expect(programa.avisoVencimientoActivo).toBe(false);
    expect(programa.avisoVencimientoDias).toBe(20);
    expect(programa.avisoVencimientoMensaje).toBe('Pasá a renovar, te esperamos');
  });

  it('acortar la duración por debajo del aviso, en el mismo envío, se rechaza con el motivo', async () => {
    // El caso del dueño: tenía 30 días con aviso a 20, cambia la duración a 15 y deja el aviso.
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const programaId = await membresiaConAviso(comercioId);

    const html = await dibujar(comercioId, programaId);
    const res = await accionGuardarConfiguracionPrograma(programaId, undefined, enviar(html, { membresia_dias: '15' }));

    expect(res).toEqual({
      error:
        'El aviso tiene que salir con menos de 15 días de anticipación: cada renovación dura 15 días, así que avisar 20 días antes le diría "está por vencer" al socio apenas termina de pagar.',
    });
    expect((await leerPrograma(comercioId, programaId)).membresiaDias).toBe(30);
  });

  it('un cupón también lo ofrece: el bloque se dibuja por tener vencimiento, no por ser membresía', async () => {
    const comercioId = await entorno.crearComercio();
    const programaId = await crear(comercioId, nuevo('cupon', { cuponVigenciaDias: 10 }));

    const html = await dibujar(comercioId, programaId);

    expect(html).toContain('name="aviso_vencimiento_activo"');
    expect(html).toContain('name="aviso_vencimiento_dias"');
    expect(html).toContain('name="aviso_vencimiento_mensaje"');
    expect(html).toContain('Tu cupón está por vencer. Aprovechalo antes de que se te pase. Vence el 12 de octubre de 2026.');
  });

  it('un tipo SIN vigencia no dibuja el bloque, y guardar su configuración no rompe nada', async () => {
    // Sin el bloque no viaja ningún campo del aviso y la acción guarda false/null. Es correcto: en
    // estos tipos el aviso nace apagado y en null, y ninguna pantalla lo puede encender.
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const programaId = await crear(comercioId, nuevo('cashback', { cashbackPorcentaje: 3 }));

    const html = await dibujar(comercioId, programaId);
    expect(html).not.toContain('aviso_vencimiento');
    expect(html).not.toContain('Vence el');

    const res = await accionGuardarConfiguracionPrograma(
      programaId,
      undefined,
      enviar(html, { cashback_porcentaje: '7.5' }),
    );

    expect(res).toEqual({ ok: true });
    const programa = await leerPrograma(comercioId, programaId);
    expect(programa.cashbackPorcentaje).toBe(7.5);
    expect(programa.avisoVencimientoActivo).toBe(false);
    expect(programa.avisoVencimientoDias).toBeNull();
    expect(programa.avisoVencimientoMensaje).toBeNull();
  });
});
