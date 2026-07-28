import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { usarCupon, renovarMembresia } from './vigencia';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

// Fecha local del comercio en formato AAAA-MM-DD. Las pruebas usan El Salvador porque es el default
// de zona_horaria y lo que usa el RPC para decidir si un cupón venció.
function diaEnSV(desplazamientoDias = 0): string {
  const ahora = new Date(Date.now() + desplazamientoDias * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

async function estadoDe(tarjetaId: string) {
  const { data } = await supabase
    .from('tarjetas')
    .select('vigencia_hasta, usado_en')
    .eq('id', tarjetaId)
    .single();
  return data!;
}

async function ledgerDe(tarjetaId: string) {
  const { data } = await supabase
    .from('transacciones_puntos')
    .select('tipo, puntos_delta, cajero_usuario_id, sucursal_id')
    .eq('tarjeta_id', tarjetaId);
  return data ?? [];
}

describe('usarCupon', () => {
  it('marca el cupón como usado y lo deja en el historial', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const sucursalId = await entorno.crearSucursal(comercioId);
    const cajeroId = await entorno.crearCajero(comercioId);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(7) }).eq('id', id);

    const res = await usarCupon(supabase, comercioId, id, { sucursalId, cajeroUsuarioId: cajeroId });

    expect(res.ok).toBe(true);
    expect((await estadoDe(id)).usado_en).not.toBeNull();

    // Sin fila en el ledger, el historial del cliente tendría un agujero justo en el tipo donde
    // cada movimiento vale dinero.
    const ledger = await ledgerDe(id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].tipo).toBe('uso');
    expect(ledger[0].puntos_delta).toBe(0);
    expect(ledger[0].cajero_usuario_id).toBe(cajeroId);
    expect(ledger[0].sucursal_id).toBe(sucursalId);
  });

  it('NO se puede usar dos veces', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(7) }).eq('id', id);

    expect((await usarCupon(supabase, comercioId, id)).ok).toBe(true);
    const segunda = await usarCupon(supabase, comercioId, id);

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error).toBe('Este cupón ya fue usado.');
    // Y no deja un segundo movimiento: el historial diría que se entregó dos veces.
    expect(await ledgerDe(id)).toHaveLength(1);
  });

  it('veinte usos simultáneos entregan el beneficio UNA sola vez', async () => {
    // La garantía vive en el `where usado_en is null` del propio UPDATE, no en un `if` previo. Un
    // `if` antes del update es exactamente el bug que la ronda de mutación de la Tanda 1 nos
    // enseñó a no escribir: bajo READ COMMITTED los veinte leerían "sin usar" y pasarían todos.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(7) }).eq('id', id);

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => usarCupon(supabase, comercioId, id)),
    );

    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await ledgerDe(id)).toHaveLength(1);
  });

  it('el día del vencimiento TODAVÍA se puede usar', async () => {
    // El borde que importa: comparar contra current_date del servidor (UTC) mataría el cupón a las
    // 6 de la tarde del día anterior para un comercio salvadoreño.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(0) }).eq('id', id);

    expect((await usarCupon(supabase, comercioId, id)).ok).toBe(true);
  });

  it('rechaza un cupón vencido diciendo cuándo venció', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(-1) }).eq('id', id);

    const res = await usarCupon(supabase, comercioId, id);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('venció el');
    expect((await estadoDe(id)).usado_en).toBeNull();
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('un cupón sin fecha de vencimiento se puede usar', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    expect((await usarCupon(supabase, comercioId, id)).ok).toBe(true);
  });

  it('NO usa el cupón de otro comercio', async () => {
    const comercioA = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const comercioB = await entorno.crearComercio({ tipo_tarjeta: 'cupon' });
    const { id } = await entorno.crearTarjeta(comercioA, 0);

    const res = await usarCupon(supabase, comercioB, id);
    expect(res.ok).toBe(false);
    expect((await estadoDe(id)).usado_en).toBeNull();
  });
});

describe('renovarMembresia', () => {
  it('extiende desde HOY cuando la membresía estaba vencida', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia', membresia_dias: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(-10) }).eq('id', id);

    const res = await renovarMembresia(supabase, comercioId, id);

    expect(res.ok).toBe(true);
    // Desde hoy + 30, no desde la fecha vencida + 30: si arrancara desde el vencimiento, un cliente
    // que vuelve a los seis meses pagaría por días ya pasados.
    expect((await estadoDe(id)).vigencia_hasta).toBe(diaEnSV(30));
  });

  it('renovar ANTES de vencer suma sobre lo que quedaba, no lo pisa', async () => {
    // Si arrancara desde hoy, renovar con 5 días de saldo se los comería — el cliente perdería
    // días que ya había pagado.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia', membresia_dias: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await supabase.from('tarjetas').update({ vigencia_hasta: diaEnSV(5) }).eq('id', id);

    await renovarMembresia(supabase, comercioId, id);

    expect((await estadoDe(id)).vigencia_hasta).toBe(diaEnSV(35));
  });

  it('activa una membresía que nunca se había activado', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia', membresia_dias: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await renovarMembresia(supabase, comercioId, id);

    expect(res.ok).toBe(true);
    expect((await estadoDe(id)).vigencia_hasta).toBe(diaEnSV(30));
  });

  it('dos renovaciones simultáneas suman DOS períodos, no uno', async () => {
    // El motivo por el que la fecha se calcula dentro del UPDATE. Con leer-modificar-escribir las
    // dos leerían la misma base y escribirían el mismo resultado: el cliente pagó dos y recibió uno.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia', membresia_dias: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const resultados = await Promise.all([
      renovarMembresia(supabase, comercioId, id),
      renovarMembresia(supabase, comercioId, id),
    ]);

    expect(resultados.every((r) => r.ok)).toBe(true);
    expect((await estadoDe(id)).vigencia_hasta).toBe(diaEnSV(60));
    expect(await ledgerDe(id)).toHaveLength(2);
  });

  it('avisa cuando el comercio no configuró la duración', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await renovarMembresia(supabase, comercioId, id);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('cuántos días dura');
    expect((await estadoDe(id)).vigencia_hasta).toBeNull();
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('deja la renovación en el historial', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'membresia', membresia_dias: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const cajeroId = await entorno.crearCajero(comercioId);

    await renovarMembresia(supabase, comercioId, id, { cajeroUsuarioId: cajeroId });

    const ledger = await ledgerDe(id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].tipo).toBe('renovacion');
    expect(ledger[0].cajero_usuario_id).toBe(cajeroId);
  });
});
