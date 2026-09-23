import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { crearPrograma } from '@/lib/comercio/programas';

// El gate compartido se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyComercioAcceso. Mismo criterio que las pruebas de branding, sucursales y del cartel.
// `rol` y `usuarioComercioId` son configurables solo para las pruebas de la autorización del dueño
// (quién puede autorizar, y a quién se le atribuye); afterEach los devuelve al dueño sin usuario.
const { sesion } = vi.hoisted(() => ({
  sesion: { comercioId: '', rol: 'owner', usuarioComercioId: null as string | null },
}));
vi.mock('@/lib/comercio/verifyComercioAcceso', () => ({
  verifyComercioAcceso: async () => ({
    comercioId: sesion.comercioId,
    rol: sesion.rol,
    sucursalId: null,
    usuarioComercioId: sesion.usuarioComercioId,
  }),
}));
// La propagación al pass no es lo que se prueba acá, y Google NO se toca nunca desde las pruebas.
vi.mock('@/lib/apple/notificarCambioTarjeta', () => ({ notificarCambioTarjeta: async () => {} }));
vi.mock('@/lib/google/syncObjeto', () => ({ syncObjetoTarjeta: async () => {} }));

const { accionBuscarPorToken, accionOperacionPrincipal, accionOperacionSecundaria, accionAutorizarOperacion } =
  await import('./actions');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  sesion.rol = 'owner';
  sesion.usuarioComercioId = null;
  await entorno.limpiar();
});

// Lo que se mide acá es LO QUE VE EL CAJERO al escanear, no un predicado puro: el defecto no vivía
// en el catálogo de tipos sino en la CONSULTA de esta acción, que traía las recompensas del comercio
// sin mirar el tipo de la tarjeta.
describe('accionBuscarPorToken — las recompensas que se le muestran al cajero', () => {
  it('una MEMBRESÍA no trae ninguna recompensa, aunque el comercio tenga premios cargados', async () => {
    // Un premio se canjea descontando `puntos_actuales`, y en membresía ese contador es 0 para
    // siempre (su estado es una fecha). O sea que el bloque "Canjear recompensa" salía con el botón
    // deshabilitado en TODOS los premios, en la pantalla más usada del mostrador y sin ninguna
    // forma de que eso cambiara nunca.
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    await entorno.crearRecompensa(comercioId, 8);

    const programa = await crearPrograma(supabase, comercioId, {
      nombre: 'Socios',
      tipoTarjeta: 'membresia',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: 30,
      cuponVigenciaDias: null,
    });
    expect(programa.ok).toBe(true);
    if (!programa.ok) return;

    const tarjeta = await entorno.crearTarjeta(comercioId, 0, { programaId: programa.id });
    const resultado = await accionBuscarPorToken(tarjeta.qrToken);

    expect(resultado.encontrado).toBe(true);
    expect(resultado.tipoTarjeta).toBe('membresia');
    expect(resultado.recompensas, 'el cajero de una membresía no puede canjear nada').toEqual([]);
  });

  it('la MISMA recompensa del MISMO comercio sí llega en la tarjeta de sellos', async () => {
    // La otra mitad, y la que discrimina de verdad: si la consulta se rompiera del todo (o el
    // filtro se aplicara al revés), la prueba de arriba pasaría igual y el mostrador se quedaría
    // sin poder canjear un premio en los tipos donde el canje es el negocio entero.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;
    await entorno.crearRecompensa(comercioId, 8);

    // El programa PRINCIPAL de crearComercio es de sellos, así que la tarjeta va derecho ahí.
    const tarjeta = await entorno.crearTarjeta(comercioId, 3);
    const resultado = await accionBuscarPorToken(tarjeta.qrToken);

    expect(resultado.encontrado).toBe(true);
    expect(resultado.recompensas).toHaveLength(1);
    // Formateado del lado del servidor, en la unidad del programa: el cajero no lee "8 puntos"
    // sobre una tarjeta de sellos.
    expect(resultado.recompensas![0].costoTexto).toBe('8 sellos');
  });

  it('un CUPÓN tampoco, y su saldo se sigue describiendo bien', async () => {
    // El tercer tipo sin contador entra por la misma puerta. Y se afirma el saldo para que la
    // prueba no pueda pasar con una acción que devuelva un objeto vacío.
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    await entorno.crearRecompensa(comercioId, 8);

    const programa = await crearPrograma(supabase, comercioId, {
      nombre: 'Bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 30,
    });
    expect(programa.ok).toBe(true);
    if (!programa.ok) return;

    const tarjeta = await entorno.crearTarjeta(comercioId, 0, { programaId: programa.id });
    const resultado = await accionBuscarPorToken(tarjeta.qrToken);

    expect(resultado.recompensas).toEqual([]);
    expect(resultado.saldoTexto).toBe('Disponible');
  });
});

// `pedir_monto_compra` es del COMERCIO, pero el campo del monto es de la TARJETA: un comercio de
// puntos con la perilla prendida puede tener además un programa de cupón, y usar_cupon_atomico (0019)
// no recibe monto. Antes el escáner leía la perilla sin mirar el tipo, y el cajero tecleaba sobre el
// cupón un monto que se descartaba. Se mide sobre la acción, no sobre `usaMontoDeCompra`: el defecto
// vivía en esta consulta, no en el catálogo.
//
// `accionBuscarPorToken` suma `exigir_monto_compra, monto_minimo_compra_centavos` al `select` de
// `comercios` (migración 0039, aplicada y verificada el 2026-09-23) — la prueba "sobre la tarjeta de
// PUNTOS del mismo comercio, sí" corre en verde.
describe('accionBuscarPorToken — si al cajero se le pide el monto de la compra', () => {
  async function comercioDePuntosConCupon() {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'puntos', pedir_monto_compra: true });
    sesion.comercioId = comercioId;
    const cupon = await crearPrograma(supabase, comercioId, {
      nombre: 'Bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 30,
    });
    if (!cupon.ok) throw new Error(`[test] no se pudo crear el cupón: ${cupon.error}`);
    return { comercioId, cuponId: cupon.id };
  }

  it('sobre el CUPÓN de un comercio de puntos con la perilla prendida, no se pide', async () => {
    const { comercioId, cuponId } = await comercioDePuntosConCupon();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, { programaId: cuponId });

    const resultado = await accionBuscarPorToken(tarjeta.qrToken);

    expect(resultado.tipoTarjeta).toBe('cupon');
    expect(resultado.pedirMontoCompra, 'usar un cupón no recibe monto: el campo sería de adorno').toBe(false);
  });

  it('sobre la tarjeta de PUNTOS del mismo comercio, sí', async () => {
    // La otra mitad, la que discrimina: si la acción apagara el campo para todos, la prueba de arriba
    // pasaría igual y el dueño perdería la evidencia que prendió la perilla para juntar.
    const { comercioId } = await comercioDePuntosConCupon();
    const tarjeta = await entorno.crearTarjeta(comercioId, 5);

    const resultado = await accionBuscarPorToken(tarjeta.qrToken);

    expect(resultado.tipoTarjeta).toBe('puntos');
    expect(resultado.pedirMontoCompra).toBe(true);
  });
});

// Cuando una perilla antifraude frena una operación, el dueño la autoriza desde el mismo escáner.
// El defecto: lo que se autorizaba no era la operación sino un `delta` que el CLIENTE calculaba, y
// que valía 1 en todo lo que no fuera puntos. Vender un paquete de 10 visitas acreditaba 1 visita;
// cargar $25.00 en una gift card acreditaba 1 centavo; el cashback de una compra, 1 centavo. El
// cliente pagaba y recibía casi nada, sin ningún error a la vista.
//
// Antes del arreglo, estas tres pruebas se corrieron llamando a la acción vieja con el delta que
// armaba Escaner.tsx, y fallaron con "expected 1 to be 10", "expected 1 to be 2500" y "expected 1
// to be 1250"; la de sellos y puntos pasaba. Ahora la autorización manda QUÉ operación era.
//
// MUTACIÓN (2026-09-13): hacer que acreditadorForzado (lib/comercio/acreditar.ts) escriba siempre
// delta 1 — el equivalente del `delta: 1` fijo en este diseño — hace fallar PREPAGO, GIFT CARD y
// CASHBACK con esos mismos tres mensajes, la de puntos con "expected 1 to be 5" y la de auditoría
// en `puntos_delta`. No pasarle el escritor forzado a venderPaquete (queda el default normal) hace
// fallar PREPAGO en `res.ok`: la autorización vuelve a chocar con el techo, que es el lado seguro.
//
// Cada prueba hace el recorrido del mostrador: la operación normal queda BLOQUEADA (y se verifica
// que no escribió nada — si no se bloqueara, la autorización acreditaría dos veces y la prueba
// mediría otra cosa), y después el dueño la autoriza. Se mide el SALDO en la base, que es lo que
// le importa al cliente, no la respuesta de la acción.
//
// La configuración de cada tipo (visitas del paquete, porcentaje) va en un programa creado por su
// id; las columnas legadas del comercio quedan vacías. Lo único que va en el comercio son las
// perillas antifraude, que sí son política del local.
describe('autorizar una operación bloqueada — acredita lo que la operación valía', () => {
  const MOTIVO = 'Pagó en efectivo, lo autorizo yo';


  async function saldoDe(tarjetaId: string): Promise<number> {
    const { data, error } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
    if (error) throw error;
    return data.puntos_actuales;
  }

  async function acreditacionesDe(tarjetaId: string) {
    const { data, error } = await supabase
      .from('transacciones_puntos')
      .select('puntos_delta, forzado, motivo, sucursal_id, cajero_usuario_id, monto_compra')
      .eq('tarjeta_id', tarjetaId)
      .eq('tipo', 'acreditacion')
      .order('created_at');
    if (error) throw error;
    return data;
  }

  async function programa(comercioId: string, datos: Partial<Parameters<typeof crearPrograma>[2]> & { tipoTarjeta: string }) {
    const res = await crearPrograma(supabase, comercioId, {
      nombre: `Programa ${datos.tipoTarjeta}`,
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
      ...datos,
    });
    if (!res.ok) throw new Error(`[test] no se pudo crear el programa: ${res.error}`);
    return res.id;
  }

  it('PREPAGO: vender un paquete de 10 visitas bloqueado por el techo acredita 10 visitas, no 1', async () => {
    const comercioId = await entorno.crearComercio({ techo_puntos_acreditacion: 5 });
    sesion.comercioId = comercioId;
    const programaId = await programa(comercioId, { tipoTarjeta: 'prepago', multipassVisitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 0, { programaId });

    const bloqueada = await accionOperacionSecundaria(id, null, '');
    expect(bloqueada.ok).toBe(false);
    if (!bloqueada.ok) expect(bloqueada.bloqueoLimite).toBe(true);
    expect(await saldoDe(id), 'el intento bloqueado no puede haber escrito nada').toBe(0);

    const res = await accionAutorizarOperacion(id, { tipo: 'secundaria', montoTexto: '' }, MOTIVO, null);

    expect(res.ok).toBe(true);
    expect(await saldoDe(id), 'el cliente pagó un paquete de 10 visitas').toBe(10);
  });

  it('GIFT CARD: cargar $25.00 bloqueado por el techo acredita 2500 centavos, no 1', async () => {
    const comercioId = await entorno.crearComercio({ techo_puntos_acreditacion: 1000 });
    sesion.comercioId = comercioId;
    const programaId = await programa(comercioId, { tipoTarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 0, { programaId });

    const bloqueada = await accionOperacionSecundaria(id, null, '25.00');
    expect(bloqueada.ok).toBe(false);
    if (!bloqueada.ok) expect(bloqueada.bloqueoLimite).toBe(true);
    expect(await saldoDe(id)).toBe(0);

    const res = await accionAutorizarOperacion(id, { tipo: 'secundaria', montoTexto: '25.00' }, MOTIVO, null);

    expect(res.ok).toBe(true);
    expect(await saldoDe(id), 'el cliente pagó $25.00 de saldo').toBe(2500);
  });

  it('CASHBACK: el 5 % de una compra de $250.00 bloqueado por el techo acredita 1250 centavos, no 1', async () => {
    const comercioId = await entorno.crearComercio({ techo_puntos_acreditacion: 1000 });
    sesion.comercioId = comercioId;
    const programaId = await programa(comercioId, { tipoTarjeta: 'cashback', cashbackPorcentaje: 5 });
    const { id } = await entorno.crearTarjeta(comercioId, 0, { programaId });

    const bloqueada = await accionOperacionPrincipal(id, null, 1, '250.00');
    expect(bloqueada.ok).toBe(false);
    if (!bloqueada.ok) expect(bloqueada.bloqueoLimite).toBe(true);
    expect(await saldoDe(id)).toBe(0);

    const res = await accionAutorizarOperacion(
      id,
      { tipo: 'principal', cantidad: 1, montoTexto: '250.00' },
      MOTIVO,
      null,
    );

    expect(res.ok).toBe(true);
    expect(await saldoDe(id), '5 % de $250.00 son $12.50').toBe(1250);
  });

  // `ejecutarOperacion` llama a `leerReglaDeMonto` ANTES de acreditar en la rama `default`
  // (puntos/sellos) — con la migración 0039 aplicada y verificada (2026-09-23), esta prueba corre en
  // verde: el comercio de este describe no configura la regla, así que `validarMontoAcreditacion`
  // no la bloquea.
  it('SELLOS y PUNTOS siguen acreditando lo que el cajero intentó: un sello, y los puntos que tecleó', async () => {
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1, techo_puntos_acreditacion: 3 });
    sesion.comercioId = comercioId;

    // Sellos: el tope de UNA acreditación por día deja pasar el primer sello y bloquea el segundo.
    const sellosId = await programa(comercioId, { tipoTarjeta: 'sellos' });
    const sellos = await entorno.crearTarjeta(comercioId, 0, { programaId: sellosId });
    expect((await accionOperacionPrincipal(sellos.id, null, 1, '')).ok).toBe(true);
    const selloBloqueado = await accionOperacionPrincipal(sellos.id, null, 1, '');
    expect(selloBloqueado.ok).toBe(false);
    if (!selloBloqueado.ok) expect(selloBloqueado.bloqueoLimite).toBe(true);

    const resSello = await accionAutorizarOperacion(
      sellos.id,
      { tipo: 'principal', cantidad: 1, montoTexto: '' },
      MOTIVO,
      null,
    );
    expect(resSello.ok).toBe(true);
    expect(await saldoDe(sellos.id)).toBe(2);

    // Puntos: el principal del comercio es de puntos (el default). 5 pasa el techo de 3.
    const puntos = await entorno.crearTarjeta(comercioId, 0);
    const puntosBloqueados = await accionOperacionPrincipal(puntos.id, null, 5, '');
    expect(puntosBloqueados.ok).toBe(false);
    if (!puntosBloqueados.ok) expect(puntosBloqueados.bloqueoLimite).toBe(true);

    const resPuntos = await accionAutorizarOperacion(
      puntos.id,
      { tipo: 'principal', cantidad: 5, montoTexto: '' },
      MOTIVO,
      null,
    );
    expect(resPuntos.ok).toBe(true);
    expect(await saldoDe(puntos.id)).toBe(5);
  });

  it('la autorización queda auditada: forzada, con el motivo, la sucursal, quien autorizó y el monto', async () => {
    // Repetir la operación no puede costar la auditoría antifraude, que es la razón de ser del
    // camino forzado. Y el intento bloqueado no deja fila: hay UNA sola acreditación.
    const comercioId = await entorno.crearComercio({ techo_puntos_acreditacion: 1000 });
    sesion.comercioId = comercioId;
    const sucursalId = await entorno.crearSucursal(comercioId);
    // El fixture solo sabe crear usuarios con rol cajero; para el RPC basta con que la FK resuelva,
    // y el rol que cuenta acá es el de la sesión (dueño).
    sesion.usuarioComercioId = await entorno.crearCajero(comercioId);
    const programaId = await programa(comercioId, { tipoTarjeta: 'cashback', cashbackPorcentaje: 5 });
    const { id } = await entorno.crearTarjeta(comercioId, 0, { programaId });

    const bloqueada = await accionOperacionPrincipal(id, sucursalId, 1, '250.00');
    if (bloqueada.ok) throw new Error('[test] la compra tenía que quedar bloqueada por el techo');

    const res = await accionAutorizarOperacion(
      id,
      { tipo: 'principal', cantidad: 1, montoTexto: '250.00' },
      MOTIVO,
      sucursalId,
    );
    expect(res.ok).toBe(true);

    const filas = await acreditacionesDe(id);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      puntos_delta: 1250,
      forzado: true,
      motivo: MOTIVO,
      sucursal_id: sucursalId,
      cajero_usuario_id: sesion.usuarioComercioId,
    });
    expect(Number(filas[0].monto_compra), 'la compra que originó el cashback').toBe(250);
  });

  it('un CAJERO no puede autorizar: no se acredita nada', async () => {
    // MUTACIÓN (2026-09-13): borrar el chequeo de rol de accionAutorizarOperacion hace fallar esta
    // prueba con la respuesta `{ ok: true, puntosActuales: 10, … }`: el cajero se autorizaba solo.
    const comercioId = await entorno.crearComercio({ techo_puntos_acreditacion: 5 });
    sesion.comercioId = comercioId;
    sesion.rol = 'cajero';
    const programaId = await programa(comercioId, { tipoTarjeta: 'prepago', multipassVisitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 0, { programaId });

    const bloqueada = await accionOperacionSecundaria(id, null, '');
    if (bloqueada.ok) throw new Error('[test] la venta tenía que quedar bloqueada por el techo');

    const res = await accionAutorizarOperacion(id, { tipo: 'secundaria', montoTexto: '' }, MOTIVO, null);

    expect(res).toEqual({
      ok: false,
      error: 'Solo el dueño puede autorizar esta acreditación.',
    });
    expect(await saldoDe(id)).toBe(0);
  });

  it('una operación que ninguna perilla bloquea no se ejecuta "autorizada" (usar una visita)', async () => {
    // Usar una visita tiene RPC propio y no pasa por acreditar_atomico. Si la autorización la
    // corriera, gastaría la visita del cliente bajo un motivo que no levantó ningún límite. Se
    // arranca con visitas para que la prueba discrimine: con 0, usar_visita fallaría igual.
    // MUTACIÓN (2026-09-13): quitar SIN_LIMITE_QUE_AUTORIZAR del caso 'prepago' hace fallar esta
    // prueba con `{ ok: true, puntosActuales: 2, … }`: se gastó una visita.
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;
    const programaId = await programa(comercioId, { tipoTarjeta: 'prepago', multipassVisitas: 10 });
    const { id } = await entorno.crearTarjeta(comercioId, 3, { programaId });

    const res = await accionAutorizarOperacion(id, { tipo: 'principal', cantidad: 1, montoTexto: '' }, MOTIVO, null);

    expect(res).toEqual({ ok: false, error: 'Esa operación no tiene ningún límite que autorizar.' });
    expect(await saldoDe(id), 'no se gastó ninguna visita').toBe(3);
  });
});

// La regla de mínimo de compra del comercio (migración 0039, lib/comercio/montoAcreditacion.ts),
// aplicada en el escáner (Tarea 5, plan 2026-09-23-onboarding-manifest-monto-resena.md). Nace del
// primer onboarding real (2026-09-22): un comercio quiere "solo sumar sellos con compras de $10 en
// adelante" en vez de sumar con cualquier compra.
//
// Mutation-testing CONFIRMADO (2026-09-23, con la 0039 aplicada), cada una restaurada después de
// corrida:
// - Pasar `autorizado: false` fijo en la llamada a `validarMontoAcreditacion` dentro de
//   `ejecutarOperacion` (en vez de `autorizacion !== null`): falla "el dueño autoriza con motivo una
//   compra de '9.99' bajo el mínimo: se acredita y el saldo sube" — el dueño se quedaba sin ninguna
//   forma de autorizar una compra bajo el mínimo.
// - Mover la llamada a `leerReglaDeMonto`/`validarMontoAcreditacion` de ADENTRO del caso `default`
//   del switch a ANTES del switch entero (aplicándola a los ocho tipos): falla "en un CUPÓN del
//   mismo comercio, sin monto, la respuesta no es ni el error de monto faltante ni el del mínimo" —
//   un cupón sin monto pasaba a rechazarse con el error de monto faltante, cuando usar un cupón no
//   debería mirar esta regla en absoluto.
// - Quitar `bloqueoLimite: chequeo.bloqueoLimite` del `return` del rechazo (dejar solo `error`):
//   falla "con '9.99' (mínimo $10.00): se rechaza con el mensaje exacto, bloqueoLimite, y el saldo
//   no cambia" — la aserción `bloqueoLimite: true`.
describe('la regla de mínimo de compra en el escáner (0039)', () => {
  const MOTIVO = 'Es clienta de toda la vida, se lo autorizo';

  async function saldoDe(tarjetaId: string): Promise<number> {
    const { data, error } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
    if (error) throw error;
    return data.puntos_actuales;
  }

  // Las TRES columnas juntas en UN update: `exigir` implica `pedir`, y el mínimo implica `exigir`
  // (los dos CHECK nuevos de la 0039) — poner solo `monto_minimo_compra_centavos` sin las otras dos
  // viola esos CHECK aunque las columnas SÍ existieran.
  async function setearReglaMinimo(comercioId: string, minimoCentavos: number) {
    const { error } = await supabase
      .from('comercios')
      .update({ pedir_monto_compra: true, exigir_monto_compra: true, monto_minimo_compra_centavos: minimoCentavos })
      .eq('id', comercioId);
    if (error) throw error;
  }

  async function comercioDeSellosConMinimo() {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    sesion.comercioId = comercioId;
    await setearReglaMinimo(comercioId, 1000);
    return comercioId;
  }

  it("con '9.99' (mínimo $10.00): se rechaza con el mensaje exacto, bloqueoLimite, y el saldo no cambia", async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0);

    const res = await accionOperacionPrincipal(tarjeta.id, null, 1, '9.99');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('La compra mínima para sumar es $10.00.');
      expect(res.bloqueoLimite).toBe(true);
    }
    expect(await saldoDe(tarjeta.id), 'el intento bajo el mínimo no puede haber escrito nada').toBe(0);
  });

  it("con '10.00' (el mínimo es inclusivo): se acredita y el saldo sube 1", async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0);

    const res = await accionOperacionPrincipal(tarjeta.id, null, 1, '10.00');

    expect(res.ok).toBe(true);
    expect(await saldoDe(tarjeta.id)).toBe(1);
  });

  it('sin monto: error de monto faltante EXACTO, sin bloqueoLimite, y el saldo no cambia', async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0);

    const res = await accionOperacionPrincipal(tarjeta.id, null, 1, '');

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Escribí el monto de la compra (por ejemplo 19.99).');
      expect(res.bloqueoLimite).toBeUndefined();
    }
    expect(await saldoDe(tarjeta.id)).toBe(0);
  });

  it("el dueño autoriza con motivo una compra de '9.99' bajo el mínimo: se acredita y el saldo sube", async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const tarjeta = await entorno.crearTarjeta(comercioId, 0);

    // Primero queda bloqueada (mismo recorrido que el cajero ve en el mostrador) y después el dueño
    // la autoriza repitiendo la MISMA operación, como ya hace el resto de las perillas antifraude.
    const bloqueada = await accionOperacionPrincipal(tarjeta.id, null, 1, '9.99');
    expect(bloqueada.ok).toBe(false);

    const res = await accionAutorizarOperacion(
      tarjeta.id,
      { tipo: 'principal', cantidad: 1, montoTexto: '9.99' },
      MOTIVO,
      null,
    );

    expect(res.ok).toBe(true);
    expect(await saldoDe(tarjeta.id), 'el dueño autorizó la compra bajo el mínimo').toBe(1);
  });

  it('en un CUPÓN del mismo comercio, sin monto, la respuesta no es ni el error de monto faltante ni el del mínimo', async () => {
    // Un cupón y no una gift card a propósito (plan, Tarea 5): la gift card en cero falla por saldo
    // insuficiente y enturbiaría qué mensaje se está midiendo acá.
    const comercioId = await comercioDeSellosConMinimo();
    const cupon = await crearPrograma(supabase, comercioId, {
      nombre: 'Bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 30,
    });
    if (!cupon.ok) throw new Error(`[test] no se pudo crear el cupón: ${cupon.error}`);
    const tarjeta = await entorno.crearTarjeta(comercioId, 0, { programaId: cupon.id });

    const res = await accionOperacionPrincipal(tarjeta.id, null, 1, '');

    // No se afirma `ok: true`: un cupón recién creado por el fixture puede fallar por razones
    // propias (p. ej. su vigencia) que no tienen nada que ver con esta regla. Lo único que le
    // corresponde a esta prueba es que la regla de monto —que no aplica a 'cupon'— no lo haya
    // tocado.
    if (!res.ok) {
      expect(res.error, 'la regla de monto no debe aplicarse a un cupón').not.toBe(
        'Escribí el monto de la compra (por ejemplo 19.99).',
      );
      expect(res.error).not.toBe('La compra mínima para sumar es $10.00.');
    }
  });

  it('accionBuscarPorToken: exigirMontoCompra y montoMinimoTexto en sellos; ausentes/false en cupón', async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const tarjetaSellos = await entorno.crearTarjeta(comercioId, 0);
    const cupon = await crearPrograma(supabase, comercioId, {
      nombre: 'Bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 30,
    });
    if (!cupon.ok) throw new Error(`[test] no se pudo crear el cupón: ${cupon.error}`);
    const tarjetaCupon = await entorno.crearTarjeta(comercioId, 0, { programaId: cupon.id });

    const resultadoSellos = await accionBuscarPorToken(tarjetaSellos.qrToken);
    expect(resultadoSellos.exigirMontoCompra).toBe(true);
    expect(resultadoSellos.montoMinimoTexto).toBe('$10.00');

    const resultadoCupon = await accionBuscarPorToken(tarjetaCupon.qrToken);
    expect(resultadoCupon.exigirMontoCompra ?? false, 'un cupón no recibe monto: no hay mínimo que mostrar').toBe(
      false,
    );
    expect(resultadoCupon.montoMinimoTexto ?? null).toBeNull();
  });
});

// A diferencia del describe de arriba, ESTA prueba corre HOY, sin la 0039: no depende de setear la
// regla en `comercios` (esa es la parte que necesita las columnas nuevas), sino de que
// `leerReglaDeMonto` no pueda resolver NINGUNA fila para el `comercioId` de la sesión — algo que pasa
// tanto hoy (la columna no existe: 42703) como después de la 0039 (con un `comercioId` que no matchea
// ninguna fila: sin error, pero `!data` es true). En los dos casos `leerReglaDeMonto` devuelve `null`
// por el mismo motivo de fondo (revisión de calidad, 2026-09-23): es la tentación más realista del
// próximo que vea "el escáner rechaza todo" y quiera pasar esta rama a fallar ABIERTA (asumir "sin
// regla" cuando no se puede leer) en vez de CERRADA. Eso estaría mal incluso con la 0039 aplicada: la
// spec dice explícitamente "falla hacia lo restrictivo: una falla de lectura acá casi seguro tumbaría
// el RPC igual" (sección 2, "La regla, en una función pura").
//
// Por qué la ejecución SÍ llega hasta la lectura de la regla con un comercioId inexistente (y no
// falla antes, por otra razón): `resolverProgramaDeTarjeta` (lib/comercio/programas.ts:478-485)
// filtra `tarjetas` por `id` Y `comercio_id` juntos; sin fila que matchee esos dos, devuelve `null`
// SIN lanzar, y `ejecutarOperacion` cae al tipo por default ('puntos'), que es justo la rama `default`
// del switch donde vive la lectura de la regla. Verificado leyendo el código, no asumido.
//
// MUTACIÓN CONFIRMADA (2026-09-23): cambiar el `if (regla === null) return {...}` por
// `const regla = (await leerReglaDeMonto(supabase, sesion.comercioId)) ?? { exigir: false,
// minimoCentavos: null };` (fallar ABIERTA en vez de CERRADA) hace fallar esta prueba: en vez de
// `{ ok: false, error: 'No se pudo verificar la regla de monto. Probá de nuevo.' }`, devuelve
// `{ ok: false, error: 'Esa tarjeta no existe en tu comercio.' }` (lib/comercio/acreditar.ts:182) —
// la ejecución sigue de largo hasta `acreditar`, que es justamente lo que esta prueba existe para
// impedir. Corrida y restaurada.
describe('la regla de monto — falla hacia lo restrictivo si no se puede leer (corre HOY, sin la 0039)', () => {
  it('un comercioId que no resuelve ninguna fila rechaza sin acreditar, con el mensaje de "no se pudo verificar"', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const tarjeta = await entorno.crearTarjeta(comercioId, 0);
    // La sesión usa un comercioId que NINGUNA tarjeta tiene — a propósito, no el del comercio real
    // que se acaba de crear (ver el comentario de arriba sobre por qué esto llega hasta la lectura
    // de la regla en vez de fallar antes).
    sesion.comercioId = '00000000-0000-0000-0000-000000000000';

    const res = await accionOperacionPrincipal(tarjeta.id, null, 1, '10.00');

    expect(res).toEqual({ ok: false, error: 'No se pudo verificar la regla de monto. Probá de nuevo.' });

    const { data, error } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjeta.id).single();
    if (error) throw error;
    expect(data.puntos_actuales, 'el intento con un comercioId que no resuelve nada no escribió nada').toBe(0);
  });
});
