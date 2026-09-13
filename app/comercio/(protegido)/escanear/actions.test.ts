import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';
import { crearPrograma } from '@/lib/comercio/programas';

// El gate compartido se mockea porque necesita cookies de una request real; se prueba aparte en
// verifyComercioAcceso. Mismo criterio que las pruebas de branding, sucursales y del cartel.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioAcceso', () => ({
  verifyComercioAcceso: async () => ({
    comercioId: sesion.comercioId,
    rol: 'owner',
    sucursalId: null,
    usuarioComercioId: null,
  }),
}));
// La propagación al pass no es lo que se prueba acá, y Google NO se toca nunca desde las pruebas.
vi.mock('@/lib/apple/notificarCambioTarjeta', () => ({ notificarCambioTarjeta: async () => {} }));
vi.mock('@/lib/google/syncObjeto', () => ({ syncObjetoTarjeta: async () => {} }));

const { accionBuscarPorToken } = await import('./actions');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

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
