import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { acreditarPuntos, acreditarForzado } from './acreditar';
import { quitarPuntos } from './ajuste';
import { canjearRecompensa } from './canje';
import { historialTarjeta } from './historial';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

// Inserta una fila del ledger con una fecha explícita, para poder armar un historial ordenado sin
// depender de la latencia de red entre llamadas.
async function ledgerEnFecha(
  tarjetaId: string,
  delta: number,
  cuando: Date,
  extra?: { tipo?: string; motivo?: string; forzado?: boolean },
) {
  const { error } = await supabase.from('transacciones_puntos').insert({
    tarjeta_id: tarjetaId,
    puntos_delta: delta,
    created_at: cuando.toISOString(),
    tipo: extra?.tipo ?? 'acreditacion',
    motivo: extra?.motivo ?? null,
    forzado: extra?.forzado ?? false,
  });
  if (error) throw error;
}

describe('historialTarjeta', () => {
  it('devuelve los movimientos del más reciente al más viejo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const base = Date.now() - 10 * 60 * 60 * 1000;
    await ledgerEnFecha(id, 1, new Date(base));
    await ledgerEnFecha(id, 2, new Date(base + 60_000));
    await ledgerEnFecha(id, 3, new Date(base + 120_000));

    const movimientos = await historialTarjeta(supabase, comercioId, id);

    expect(movimientos).not.toBeNull();
    expect(movimientos!).toHaveLength(3);
    expect(movimientos!.map((m) => m.delta)).toEqual([3, 2, 1]);
  });

  it('calcula el saldo resultante de cada movimiento', async () => {
    // El saldo corrido es lo que convierte una lista de deltas en una auditoría: deja ver que
    // después del movimiento X la tarjeta tenía Y.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const base = Date.now() - 10 * 60 * 60 * 1000;
    await ledgerEnFecha(id, 5, new Date(base));
    await ledgerEnFecha(id, 3, new Date(base + 60_000));
    await ledgerEnFecha(id, -2, new Date(base + 120_000), { tipo: 'ajuste', motivo: 'corrección' });

    const movimientos = await historialTarjeta(supabase, comercioId, id);

    // De más reciente a más viejo: 6 (5+3-2), 8 (5+3), 5.
    expect(movimientos!.map((m) => m.saldoResultante)).toEqual([6, 8, 5]);
  });

  it('el recorte por fecha NO altera los saldos resultantes', async () => {
    // LA trampa de esta función: la ventana del saldo corrido tiene que correr sobre TODOS los
    // movimientos, y el filtro p_desde aplicarse DESPUÉS. Si el filtro se mete dentro de la CTE,
    // el primer movimiento visible arranca desde cero y TODOS los saldos quedan mal — no solo los
    // recortados.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const base = Date.now() - 10 * 60 * 60 * 1000;
    await ledgerEnFecha(id, 5, new Date(base));
    await ledgerEnFecha(id, 3, new Date(base + 60_000));
    await ledgerEnFecha(id, 4, new Date(base + 120_000));

    const corte = new Date(base + 90_000).toISOString();
    const movimientos = await historialTarjeta(supabase, comercioId, id, { desde: corte });

    expect(movimientos!).toHaveLength(1);
    // 12, no 4: el movimiento recortado sigue contando para el saldo aunque no se muestre.
    expect(movimientos![0].saldoResultante).toBe(12);
    expect(movimientos![0].delta).toBe(4);
  });

  it('el límite recorta los más viejos sin alterar los saldos', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const base = Date.now() - 10 * 60 * 60 * 1000;
    await ledgerEnFecha(id, 5, new Date(base));
    await ledgerEnFecha(id, 3, new Date(base + 60_000));
    await ledgerEnFecha(id, 4, new Date(base + 120_000));

    const movimientos = await historialTarjeta(supabase, comercioId, id, { limite: 2 });

    expect(movimientos!).toHaveLength(2);
    expect(movimientos!.map((m) => m.saldoResultante)).toEqual([12, 8]);
  });

  it('incluye canjes con el nombre del premio y delta negativo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const recompensaId = await entorno.crearRecompensa(comercioId, 4);

    await acreditarPuntos(supabase, comercioId, id, 10);
    const canje = await canjearRecompensa(supabase, comercioId, id, recompensaId);
    expect(canje.ok).toBe(true);

    const movimientos = await historialTarjeta(supabase, comercioId, id);

    expect(movimientos!).toHaveLength(2);
    const elCanje = movimientos!.find((m) => m.clase === 'canje');
    expect(elCanje).toBeDefined();
    expect(elCanje!.delta).toBe(-4);
    expect(elCanje!.saldoResultante).toBe(6);
    expect(elCanje!.recompensaNombre).toBe('Premio Prueba');
  });

  it('muestra el nombre del premio aunque la recompensa se haya desactivado después', async () => {
    // recompensas usa soft-delete, y el LEFT JOIN recupera el nombre. Una tabla de historial
    // separada habría tenido que congelar ese texto.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const recompensaId = await entorno.crearRecompensa(comercioId, 4);

    await acreditarPuntos(supabase, comercioId, id, 10);
    await canjearRecompensa(supabase, comercioId, id, recompensaId);
    await supabase.from('recompensas').update({ activa: false }).eq('id', recompensaId);

    const movimientos = await historialTarjeta(supabase, comercioId, id);
    const elCanje = movimientos!.find((m) => m.clase === 'canje');
    expect(elCanje!.recompensaNombre).toBe('Premio Prueba');
  });

  it('expone motivo, marca de forzada, sucursal, cajero y monto', async () => {
    // Es todo lo que hace útil la pantalla forense: sin cajero y sin hora no se puede auditar nada.
    const comercioId = await entorno.crearComercio({
      tope_acreditaciones_dia: 1,
      pedir_monto_compra: true,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const sucursalId = await entorno.crearSucursal(comercioId);
    const cajeroId = await entorno.crearCajero(comercioId);

    await acreditarPuntos(supabase, comercioId, id, 1, {
      sucursalId,
      cajeroUsuarioId: cajeroId,
      montoCompra: 9.75,
    });
    await acreditarForzado(supabase, comercioId, id, 1, 'Compró dos veces', {
      sucursalId,
      cajeroUsuarioId: cajeroId,
    });
    await quitarPuntos(supabase, comercioId, id, 1, 'me equivoqué', {
      sucursalId,
      cajeroUsuarioId: cajeroId,
    });

    const movimientos = await historialTarjeta(supabase, comercioId, id);
    expect(movimientos!).toHaveLength(3);

    const ajuste = movimientos!.find((m) => m.clase === 'ajuste');
    expect(ajuste!.motivo).toBe('me equivoqué');
    expect(ajuste!.delta).toBe(-1);
    expect(ajuste!.forzado).toBe(false);

    const forzada = movimientos!.find((m) => m.forzado);
    expect(forzada!.motivo).toBe('Compró dos veces');
    expect(forzada!.clase).toBe('acreditacion');

    const conMonto = movimientos!.find((m) => m.monto !== null);
    expect(conMonto!.monto).toBe(9.75);

    for (const m of movimientos!) {
      expect(m.sucursalNombre).toBe('Sucursal Prueba');
      expect(m.cajeroEmail).toContain('@ejemplo.test');
    }
  });

  it('NO devuelve el historial de una tarjeta de OTRO comercio', async () => {
    // Mismo scope que el resto del escáner: conocer el id de una tarjeta ajena no da acceso.
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioA, 0);
    await acreditarPuntos(supabase, comercioA, id, 3);

    const movimientos = await historialTarjeta(supabase, comercioB, id);

    expect(movimientos).toEqual([]);
  });

  it('devuelve una lista vacía (no null) para una tarjeta sin movimientos', async () => {
    // La distinción que hace útil el `T[] | null`: "no hay movimientos" NO es "no se pudieron leer".
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const movimientos = await historialTarjeta(supabase, comercioId, id);

    expect(movimientos).toEqual([]);
    expect(movimientos).not.toBeNull();
  });
});
