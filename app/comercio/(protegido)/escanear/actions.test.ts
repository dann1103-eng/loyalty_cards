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
      error: 'Solo el dueño puede autorizar una acreditación por encima del límite.',
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
