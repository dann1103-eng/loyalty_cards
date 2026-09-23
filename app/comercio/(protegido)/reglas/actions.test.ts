import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { leerControles, MAXIMO_MONTO_MINIMO_CENTAVOS } from '@/lib/comercio/controlesAcreditacion';
import { crearPrograma, desactivarPrograma, listarProgramas } from '@/lib/comercio/programas';
import { ofreceReglaDeMonto } from '@/lib/comercio/montoAcreditacion';
import { unidadPrograma } from '@/lib/tarjetas/unidadPrograma';
import { aplicanControlesAcreditacion, formatearCentavos, usaMontoDeCompra } from '@/lib/tarjetas/tipos';

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

// El formulario con las MISMAS props que le arma page.tsx a partir del programa principal —
// incluido `ofreceReglaDeMonto` (Tarea 4): la MISMA función y la MISMA llamada
// `listarProgramas(…, { soloActivos: false })` que usa page.tsx, no una copia del filtro acá. Si
// esta prueba armara la regla a mano ("¿tiene sellos?"), una mutación que le sacara
// `{ soloActivos: false }` a page.tsx (y así le escondiera al dueño los programas desactivados)
// pasaría igual — el mismo defecto de "reemplazo en todos los sitios" que ya documenta el
// CLAUDE.md del proyecto.
async function dibujarReglas(comercioId: string, tipoPrincipal: string): Promise<string> {
  const controles = await leerControles(supabase, comercioId);
  if (!controles) throw new Error('[test] no se pudieron leer los controles');
  const programas = await listarProgramas(supabase, comercioId, { soloActivos: false });
  return renderToStaticMarkup(
    createElement(FormularioControles, {
      controles,
      unidad: unidadPrograma(tipoPrincipal),
      esDePuntos: tipoPrincipal === 'puntos',
      aplicanLimites: aplicanControlesAcreditacion(tipoPrincipal),
      usaMontoDeCompra: usaMontoDeCompra(tipoPrincipal),
      ofreceReglaDeMonto: ofreceReglaDeMonto(programas ?? []),
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

// El sub-bloque nuevo de la Tarea 4 (checkbox "Exigir" + campo "Mínimo"). Se busca la casilla de
// exigir, igual criterio que CASILLA_VISIBLE de arriba (los atributos de un elemento generado por
// React SSR pueden salir en cualquier orden).
const SUBBLOQUE_VISIBLE = /<input\b[^>]*type="checkbox"[^>]*name="exigir_monto_compra"|<input\b[^>]*name="exigir_monto_compra"[^>]*type="checkbox"/;

// AVISO (Tarea 4, 2026-09-23): las CUATRO pruebas de este describe NO se tocaron — siguen exactas a
// como estaban — pero hoy quedan en rojo igual, con "column comercios.exigir_monto_compra does not
// exist" (42703): `dibujarReglas` ahora llama a `leerControles`, que agregó las dos columnas nuevas
// al select, y esa columna no existe hasta que Daniel aplique la migración 0039 en Supabase Studio.
// Es la medida exacta de lo que rompería en producción si esto se publicara sin la migración (regla
// del CLAUDE.md del proyecto). Se confirmó que las cuatro fallan por ESA razón y ninguna otra; su
// verde vuelve solo, sin cambiar nada acá, en cuanto la 0039 esté aplicada (Tarea 9).
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

// TAREA 4 — el sub-bloque nuevo (checkbox "Exigir" + campo "Mínimo") y su guardado.
//
// Mutation-testing: PURAS (lib/comercio/controlesAcreditacion.test.ts) confirmadas 2026-09-23. Las
// de acá abajo (HTML + Supabase) quedan PENDIENTES (Tarea 9, con la 0039 aplicada) — hoy ninguna
// puede correr en verde, así que ninguna se corrió todavía:
// - Precargar con `String(centavos / 100)` en vez de `formatearCentavos`: falla la aserción del
//   HTML "$10.50" exacto (la prueba de ida y vuelta de controlesAcreditacion.test.ts NO la atrapa,
//   porque "10.5" vuelve a parsear a 1050 igual).
// - Volver a condicionar el checkbox "Pedir" solo a `usaMontoDeCompra` (sin `|| ofreceReglaDeMonto`
//   en FormularioControles.tsx): falla "membresía + sellos secundario" de abajo.
// - Quitar `{ soloActivos: false }` de la llamada a `listarProgramas` en page.tsx: falla "membresía +
//   sellos secundario DESACTIVADO" de abajo (necesita el test del NAVEGADOR contra page.tsx real
//   para atraparlo del todo — acá solo se prueba `dibujarReglas`, que YA llama con `{ soloActivos:
//   false }` a propósito de no repetir el filtro; ver el comentario del helper).
// - `type="number"` en vez de `type="text"` en el campo del mínimo: falla la aserción de tipo del
//   HTML.
//
// TODAS las pruebas de este bloque pasan por `dibujarReglas`, que llama a `leerControles`, que
// selecciona `exigir_monto_compra` y `monto_minimo_compra_centavos` — columnas de la migración 0039,
// TODAVÍA NO aplicada en esta base (confirmado con scripts/verificar-0039.ts el 2026-09-23). Por eso
// TODAS quedan hoy en rojo con el mismo error de Postgres, 42703 "column
// comercios.exigir_monto_compra does not exist" — EXCEPTO la que siembra la fila con un UPDATE
// directo ANTES de llamar a dibujarReglas, que falla un paso antes, con PGRST204 (PostgREST rechaza
// el UPDATE contra su caché de esquema sin llegar a tocar Postgres). Se corrieron las cinco para
// confirmar que ninguna falla por otra razón; el verde de las cinco y sus mutaciones (arriba) se
// difieren a la Tarea 9.
describe('accionGuardarControles — el mínimo de compra (Tarea 4, migración 0039 pendiente)', () => {
  async function comercioDePuntos() {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'puntos' });
    sesion.comercioId = comercioId;
    return comercioId;
  }

  it("mínimo '10x' (typo) → NaN → error del mínimo", async () => {
    const comercioId = await comercioDePuntos();
    const html = await dibujarReglas(comercioId, 'puntos');

    const res = await accionGuardarControles(undefined, enviar(html, { monto_minimo_compra: '10x' }));

    expect(res).toEqual({
      error: 'El mínimo de compra para sumar debe ser un monto mayor que cero, o quedar vacío para no exigir un mínimo.',
    });
  });

  it("mínimo '0' → error: no es un mínimo mayor que cero", async () => {
    const comercioId = await comercioDePuntos();
    const html = await dibujarReglas(comercioId, 'puntos');

    const res = await accionGuardarControles(undefined, enviar(html, { monto_minimo_compra: '0' }));

    expect(res).toEqual({
      error: 'El mínimo de compra para sumar debe ser un monto mayor que cero, o quedar vacío para no exigir un mínimo.',
    });
  });

  it('mínimo $1,000.01 (encima del tope) → error del tope', async () => {
    const comercioId = await comercioDePuntos();
    const html = await dibujarReglas(comercioId, 'puntos');

    const res = await accionGuardarControles(undefined, enviar(html, { monto_minimo_compra: '1000.01' }));

    expect(res).toEqual({
      error: `El mínimo de compra para sumar no puede pasar de ${formatearCentavos(MAXIMO_MONTO_MINIMO_CENTAVOS)}.`,
    });
  });

  it('guardar "Exigir" + mínimo $10.50 se relee true/1050, y el HTML lo precarga EXACTO ($10.50, no 10.5)', async () => {
    const comercioId = await comercioDePuntos();
    const html = await dibujarReglas(comercioId, 'puntos');

    const res = await accionGuardarControles(
      undefined,
      enviar(html, { exigir_monto_compra: 'on', monto_minimo_compra: '$10.50' }),
    );
    expect(res).toEqual({ guardado: true });

    const controles = await leerControles(supabase, comercioId);
    expect(controles?.exigirMontoCompra).toBe(true);
    expect(controles?.montoMinimoCompraCentavos).toBe(1050);

    // Reléido: el input `type="text"` del mínimo tiene que llevar EXACTO "$10.50" (formatearCentavos),
    // no "10.5" (String(centavos / 100), la mutación que la ida-y-vuelta pura no atrapa) ni ningún
    // otro formato — y tiene que seguir siendo `type="text"`, nunca `type="number"` (ver el
    // comentario largo del campo en FormularioControles.tsx: un input numérico con value="$10.50" se
    // vaciaría solo al montar).
    const htmlReleido = await dibujarReglas(comercioId, 'puntos');
    const precarga = /<input\b(?=[^>]*\bname="monto_minimo_compra")(?=[^>]*\btype="text")(?=[^>]*\bvalue="\$10\.50")[^>]*>/;
    expect(htmlReleido).toMatch(precarga);
  });

  it('guardar con el sub-bloque ausente resetea exigir/mínimo a false/null, aunque antes hubiera algo', async () => {
    // Comercio de CUPÓN puro (sin programa de puntos/sellos): ni `usaMontoDeCompra` ni
    // `ofreceReglaDeMonto`, así que TODO el bloque "Pedir"/"Exigir"/"Mínimo" queda oculto (rama
    // `else` de FormularioControles) y ninguno de los tres campos viaja en el FormData. Se siembra
    // la fila con un UPDATE directo — no por guardarControles, que jamás se llamaría así desde la UI
    // real, y menos con exigir/mínimo puestos en un comercio que no los ofrece — para simular datos
    // que quedaron de un estado anterior (spec, "Configuración": "sin ellos preservarlos crearía...
    // un `exigir` guardado que impediría destildar 'Pedir' sin que el dueño pudiera ver por qué").
    // Lo que importa acá es que la PRÓXIMA vez que el dueño guarda esta pantalla sin ver la regla,
    // no se la lleve puesta.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    sesion.comercioId = comercioId;
    const { error: errorSiembra } = await supabase
      .from('comercios')
      .update({ pedir_monto_compra: true, exigir_monto_compra: true, monto_minimo_compra_centavos: 1050 })
      .eq('id', comercioId);
    expect(errorSiembra).toBeNull();

    const html = await dibujarReglas(comercioId, 'cupon');
    expect(html, 'un cupón sin programa de puntos/sellos no ofrece el sub-bloque').not.toMatch(SUBBLOQUE_VISIBLE);

    const res = await accionGuardarControles(undefined, enviar(html));
    expect(res).toEqual({ guardado: true });

    const controlesFinales = await leerControles(supabase, comercioId);
    expect(controlesFinales?.exigirMontoCompra).toBe(false);
    expect(controlesFinales?.montoMinimoCompraCentavos).toBeNull();
  });
});

// TAREA 4 — cuándo se le ofrece al dueño el sub-bloque, más allá del tipo PRINCIPAL: la pregunta que
// contesta `ofreceReglaDeMonto` (lib/comercio/montoAcreditacion.ts) mirando TODOS los programas, no
// solo el principal. Mismo aviso que el bloque de arriba: las tres pasan por `dibujarReglas` →
// `leerControles`, así que hoy quedan en rojo por 42703 (columna faltante, migración 0039
// pendiente); se corrieron para confirmar que fallan por ESA razón. Verde y mutaciones: Tarea 9.
describe('FormularioControles — a quién se le ofrece el sub-bloque (Tarea 4)', () => {
  it('membresía PRINCIPAL + sellos SECUNDARIO: se dibuja la casilla "Pedir" y el sub-bloque', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    sesion.comercioId = comercioId;
    const sellos = await crearPrograma(supabase, comercioId, {
      nombre: 'Sellos',
      tipoTarjeta: 'sellos',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });
    expect(sellos.ok).toBe(true);

    const html = await dibujarReglas(comercioId, 'membresia');

    expect(html, 'la membresía sola no usa el monto, pero el sellos secundario sí ofrece la regla').toMatch(CASILLA_VISIBLE);
    expect(html).toMatch(SUBBLOQUE_VISIBLE);
  });

  it('membresía PRINCIPAL + sellos SECUNDARIO DESACTIVADO: también se dibuja (sus tarjetas se siguen acreditando)', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    sesion.comercioId = comercioId;
    const sellos = await crearPrograma(supabase, comercioId, {
      nombre: 'Sellos',
      tipoTarjeta: 'sellos',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });
    expect(sellos.ok).toBe(true);
    if (!sellos.ok) return;
    const desactivado = await desactivarPrograma(supabase, comercioId, sellos.id);
    expect(desactivado.ok).toBe(true);

    const html = await dibujarReglas(comercioId, 'membresia');

    expect(html).toMatch(SUBBLOQUE_VISIBLE);
  });

  it('solo CUPÓN (sin programa de puntos/sellos): no se dibuja ni la casilla "Pedir" ni el sub-bloque', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    sesion.comercioId = comercioId;

    const html = await dibujarReglas(comercioId, 'cupon');

    expect(html).not.toMatch(CASILLA_VISIBLE);
    expect(html).not.toMatch(SUBBLOQUE_VISIBLE);
  });
});
