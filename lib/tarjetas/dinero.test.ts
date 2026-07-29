import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { calcularCashback, acreditarCashback, cargarGiftCard, consumirSaldo } from './dinero';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

async function saldoDe(tarjetaId: string): Promise<number> {
  const { data } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .single();
  return data!.puntos_actuales;
}

async function ledgerDe(tarjetaId: string) {
  const { data } = await supabase
    .from('transacciones_puntos')
    .select('tipo, puntos_delta, monto_compra')
    .eq('tarjeta_id', tarjetaId);
  return data ?? [];
}

describe('calcularCashback', () => {
  it('redondea al centavo, con el medio hacia arriba', () => {
    // $19.99 al 5% son 99.95 centavos. Redondear hacia abajo le quitaría un centavo al cliente en
    // cada compra, y eso repetido diez mil veces es una discusión con un contador.
    expect(calcularCashback(1999, 5)).toBe(100);
    expect(calcularCashback(1000, 5)).toBe(50);
    expect(calcularCashback(101, 5)).toBe(5); // 5.05 → 5
    expect(calcularCashback(110, 5)).toBe(6); // 5.5 → 6, el medio hacia arriba
  });

  it('acepta porcentajes con decimales', () => {
    expect(calcularCashback(10000, 5.5)).toBe(550);
    expect(calcularCashback(1999, 2.5)).toBe(50); // 49.975 → 50
  });

  it('una compra muy chica devuelve cero, no un centavo fantasma', () => {
    expect(calcularCashback(5, 5)).toBe(0); // 0.25 → 0
  });

  it('devuelve cero ante entradas sin sentido en vez de NaN', () => {
    // Un NaN acá termina siendo el saldo del cliente.
    for (const [monto, pct] of [[0, 5], [-100, 5], [1000, 0], [1000, -5], [NaN, 5], [1000, NaN]]) {
      expect(calcularCashback(monto, pct), `${monto} al ${pct}%`).toBe(0);
    }
  });
});

describe('acreditarCashback', () => {
  it('acredita el porcentaje configurado y guarda el monto de la compra', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cashback', cashback_porcentaje: 5 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await acreditarCashback(supabase, comercioId, id, 1999);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.saldoCentavos).toBe(100);
      // El mensaje va en PLATA, no en el número crudo: "100" sería un saldo falso para el cliente.
      expect(res.mensaje).toContain('$1.00');
    }
    expect(await saldoDe(id)).toBe(100);

    const ledger = await ledgerDe(id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].puntos_delta).toBe(100);
    // El monto de la compra queda guardado: es lo que después permite auditar cuánto se vendió por
    // cada dólar devuelto.
    expect(Number(ledger[0].monto_compra)).toBe(19.99);
  });

  it('exige el monto de la compra', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cashback', cashback_porcentaje: 5 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    for (const monto of [0, -100]) {
      const res = await acreditarCashback(supabase, comercioId, id, monto);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('monto de la compra');
    }
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('avisa cuando el comercio no configuró el porcentaje', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cashback' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await acreditarCashback(supabase, comercioId, id, 1999);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('porcentaje de cashback');
    expect(await saldoDe(id)).toBe(0);
  });

  it('dice cuando la compra es tan chica que el cashback redondea a cero', async () => {
    // Sin este aviso el cajero quedaría esperando un movimiento que nunca va a existir.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cashback', cashback_porcentaje: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await acreditarCashback(supabase, comercioId, id, 20); // $0.20 al 1% = 0.2 centavos

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('redondea a cero');
    expect(await ledgerDe(id)).toHaveLength(0);
  });
});

describe('cargarGiftCard', () => {
  it('carga saldo y lo suma al que había', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 500);

    const res = await cargarGiftCard(supabase, comercioId, id, 2500);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mensaje).toContain('$25.00');
    expect(await saldoDe(id)).toBe(3000);
  });

  it('el TECHO por transacción impide que un cajero regale una gift card grande', async () => {
    // Es el mecanismo que acordamos, y no necesitó código nuevo: cargar reusa acreditarPuntos, así
    // que techo_puntos_acreditacion aplica solo. Para un tipo de dinero se lee en CENTAVOS.
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'gift_card',
      techo_puntos_acreditacion: 5000, // $50 por carga
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const excedida = await cargarGiftCard(supabase, comercioId, id, 50001);
    expect(excedida.ok).toBe(false);
    if (!excedida.ok) expect(excedida.bloqueoLimite).toBe(true);
    expect(await saldoDe(id)).toBe(0);

    // Justo en el techo sí pasa.
    expect((await cargarGiftCard(supabase, comercioId, id, 5000)).ok).toBe(true);
    expect(await saldoDe(id)).toBe(5000);
  });

  it('rechaza cargas no positivas', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 1000);

    for (const centavos of [0, -500, 12.5]) {
      const res = await cargarGiftCard(supabase, comercioId, id, centavos);
      expect(res.ok, `${centavos}`).toBe(false);
    }
    expect(await saldoDe(id)).toBe(1000);
  });
});

describe('consumirSaldo', () => {
  it('descuenta del saldo y lo deja en el historial como "uso"', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 5000);
    const cajeroId = await entorno.crearCajero(comercioId);

    const res = await consumirSaldo(supabase, comercioId, id, 1250, { cajeroUsuarioId: cajeroId });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.saldoCentavos).toBe(3750);
      expect(res.mensaje).toContain('$37.50');
    }
    expect(await saldoDe(id)).toBe(3750);

    const ledger = await ledgerDe(id);
    expect(ledger[0].tipo).toBe('uso');
    expect(ledger[0].puntos_delta).toBe(-1250);
  });

  it('NO deja el saldo negativo, y dice cuánto hay para cobrar la diferencia', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 1000);

    const res = await consumirSaldo(supabase, comercioId, id, 2500);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      // El saldo real en el mensaje es lo que deja al cajero cobrar la diferencia en el momento en
      // vez de quedarse con la venta trabada.
      expect(res.error).toContain('$10.00');
      expect(res.error).toContain('diferencia');
    }
    expect(await saldoDe(id)).toBe(1000);
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('permite gastar exactamente todo el saldo', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 1250);

    expect((await consumirSaldo(supabase, comercioId, id, 1250)).ok).toBe(true);
    expect(await saldoDe(id)).toBe(0);
  });

  it('rechaza montos no positivos: una compra negativa REGALARÍA saldo', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 1000);

    for (const centavos of [0, -500]) {
      const res = await consumirSaldo(supabase, comercioId, id, centavos);
      expect(res.ok, `${centavos}`).toBe(false);
    }
    expect(await saldoDe(id)).toBe(1000);
  });

  it('quince cobros simultáneos no pueden gastar más de lo que hay', async () => {
    // Acá una condición de carrera cuesta DINERO: el comercio entregaría mercadería sin respaldo.
    // El guard vive en el `where puntos_actuales >= p_monto` del propio UPDATE.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioId, 3000); // $30, alcanza para 3 de $10

    const resultados = await Promise.all(
      Array.from({ length: 15 }, () => consumirSaldo(supabase, comercioId, id, 1000)),
    );

    expect(resultados.filter((r) => r.ok)).toHaveLength(3);
    expect(await saldoDe(id)).toBe(0);
    expect(await ledgerDe(id)).toHaveLength(3);
  });

  it('NO gasta el saldo de una tarjeta de otro comercio', async () => {
    const comercioA = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const comercioB = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    const { id } = await entorno.crearTarjeta(comercioA, 5000);

    const res = await consumirSaldo(supabase, comercioB, id, 1000);

    expect(res.ok).toBe(false);
    expect(await saldoDe(id)).toBe(5000);
  });
});
