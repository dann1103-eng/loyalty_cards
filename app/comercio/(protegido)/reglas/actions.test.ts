import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { leerControles } from '@/lib/comercio/controlesAcreditacion';
import { unidadPrograma } from '@/lib/tarjetas/unidadPrograma';
import { aplicanControlesAcreditacion, usaMontoDeCompra } from '@/lib/tarjetas/tipos';

// El gate del dueño se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyComercioOwner. Mismo criterio que las pruebas de sucursales y del cartel.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
// Lo importa actions.ts para las reglas; guardar los controles no lo llama, y Apple no se toca.
vi.mock('@/lib/apple/notificarCambioComercio', () => ({ notificarCambioComercio: async () => {} }));

const { accionGuardarControles } = await import('./actions');
const { default: FormularioControles } = await import('./FormularioControles');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

// POR QUÉ ESTA PRUEBA DIBUJA EL FORMULARIO, siendo que el repo no tiene pruebas de componentes:
// el defecto que protege no vive en ninguna función, vive en el PEGAMENTO entre el marcado y la
// acción. `accionGuardarControles` lee `pedir_monto_compra` del FormData y lo que no llega lo guarda
// `false`. Si la casilla no se dibuja y nadie la reemplaza por un input oculto, el dueño de un cupón
// que entra a Reglas a cambiar la zona horaria le apaga en silencio la perilla al local. Una prueba
// que armara el FormData a mano pasaría igual con el input oculto borrado: por eso el FormData sale
// del HTML real.
//
// MUTACIÓN verificada: quitar el `<input type="hidden" name="pedir_monto_compra">` de
// FormularioControles.tsx hace fallar "guardar otra cosa NO le apaga la perilla".

// Lo que el navegador enviaría al apretar Guardar: cada input con nombre en orden de documento, las
// casillas solo si están marcadas, y del <select> la opción seleccionada. `cambios` es lo que el dueño
// tocó antes de guardar (un valor nuevo, o `false` para desmarcar una casilla).
function enviar(html: string, cambios: Record<string, string | false> = {}): FormData {
  const atributos = (etiqueta: string) => {
    const mapa = new Map<string, string>();
    for (const [, nombre, valor] of etiqueta.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      mapa.set(nombre, (valor ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    }
    return mapa;
  };

  const fd = new FormData();
  for (const [bloque] of html.matchAll(/<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>/g)) {
    const apertura = bloque.match(/^<\w+\b[^>]*>/)![0];
    const attrs = atributos(apertura.slice(apertura.indexOf(' ')));
    const nombre = attrs.get('name');
    if (!nombre || attrs.has('disabled')) continue;
    const cambio = cambios[nombre];

    if (bloque.startsWith('<select')) {
      const opciones = [...bloque.matchAll(/<option\b[^>]*>/g)].map(([o]) => atributos(o.slice(7)));
      const elegida = opciones.find((o) => o.has('selected')) ?? opciones[0];
      fd.append(nombre, typeof cambio === 'string' ? cambio : (elegida?.get('value') ?? ''));
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

// El formulario con las MISMAS props que le arma page.tsx a partir del programa principal.
async function dibujarReglas(comercioId: string, tipoPrincipal: string): Promise<string> {
  const controles = await leerControles(supabase, comercioId);
  if (!controles) throw new Error('[test] no se pudieron leer los controles');
  return renderToStaticMarkup(
    createElement(FormularioControles, {
      controles,
      unidad: unidadPrograma(tipoPrincipal),
      esDePuntos: tipoPrincipal === 'puntos',
      aplicanLimites: aplicanControlesAcreditacion(tipoPrincipal),
      usaMontoDeCompra: usaMontoDeCompra(tipoPrincipal),
    }),
  );
}

async function perillaGuardada(comercioId: string) {
  const { data, error } = await supabase
    .from('comercios')
    .select('pedir_monto_compra, zona_horaria')
    .eq('id', comercioId)
    .single();
  if (error) throw error;
  return data;
}

const CASILLA_VISIBLE = /<input\b[^>]*type="checkbox"[^>]*name="pedir_monto_compra"|<input\b[^>]*name="pedir_monto_compra"[^>]*type="checkbox"/;

describe('accionGuardarControles — la perilla del monto donde el programa principal no lo usa', () => {
  it('en un CUPÓN no se le ofrece la casilla al dueño', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon', pedir_monto_compra: true });
    sesion.comercioId = comercioId;

    const html = await dibujarReglas(comercioId, 'cupon');

    expect(html, 'usar un cupón no recibe monto: la casilla sería una perilla muerta').not.toMatch(CASILLA_VISIBLE);
  });

  it('guardar otra cosa NO le apaga la perilla que ya tenía prendida', async () => {
    // La mordida: el dueño entra a cambiar la zona horaria, aprieta Guardar, y el local deja de
    // pedir el monto en su programa de puntos secundario sin que nadie lo haya decidido.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon', pedir_monto_compra: true });
    sesion.comercioId = comercioId;

    const html = await dibujarReglas(comercioId, 'cupon');
    const res = await accionGuardarControles(undefined, enviar(html, { zona_horaria: 'America/Guatemala' }));

    expect(res).toEqual({ guardado: true });
    const guardado = await perillaGuardada(comercioId);
    // La zona prueba que el guardado ocurrió de verdad: sin ella, una acción que no escribiera nada
    // dejaría la perilla en true y la prueba pasaría por la razón equivocada.
    expect(guardado.zona_horaria).toBe('America/Guatemala');
    expect(guardado.pedir_monto_compra, 'el input oculto tiene que llevar el valor guardado').toBe(true);
  });

  it('y si estaba apagada, guardar no la prende', async () => {
    // Atrapa el input oculto con value="on" escrito a mano en vez del valor guardado.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon', pedir_monto_compra: false });
    sesion.comercioId = comercioId;

    const html = await dibujarReglas(comercioId, 'cupon');
    await accionGuardarControles(undefined, enviar(html));

    expect((await perillaGuardada(comercioId)).pedir_monto_compra).toBe(false);
  });

  it('en PUNTOS la casilla se ofrece, y desmarcarla SÍ la apaga', async () => {
    // La otra mitad, la que discrimina: si el input oculto se dibujara siempre, en puntos viajarían
    // dos campos con el mismo nombre, `formData.get` devolvería el primero, y el dueño no podría
    // apagar la perilla nunca más.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'puntos', pedir_monto_compra: true });
    sesion.comercioId = comercioId;

    const html = await dibujarReglas(comercioId, 'puntos');
    expect(html).toMatch(CASILLA_VISIBLE);

    const res = await accionGuardarControles(undefined, enviar(html, { pedir_monto_compra: false }));

    expect(res).toEqual({ guardado: true });
    expect((await perillaGuardada(comercioId)).pedir_monto_compra).toBe(false);
  });
});
