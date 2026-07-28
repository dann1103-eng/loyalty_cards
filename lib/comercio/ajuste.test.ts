import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { quitarPuntos, LARGO_MAXIMO_MOTIVO } from './ajuste';

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
    .select('puntos_delta, tipo, motivo, forzado, sucursal_id, cajero_usuario_id')
    .eq('tarjeta_id', tarjetaId);
  return data ?? [];
}

describe('quitarPuntos', () => {
  it('resta la cantidad y deja una fila de ajuste con su motivo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    const res = await quitarPuntos(supabase, comercioId, id, 3, 'El cajero puso 4 sellos por error');

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.puntosActuales).toBe(2);
    expect(await saldoDe(id)).toBe(2);

    const ledger = await ledgerDe(id);
    expect(ledger).toHaveLength(1);
    // El delta guardado es NEGATIVO aunque el caller pasó una cantidad positiva: quitarPuntos arma
    // el signo. Si alguien "simplifica" pasando `cantidad` directo al RPC, esto falla.
    expect(ledger[0].puntos_delta).toBe(-3);
    expect(ledger[0].tipo).toBe('ajuste');
    expect(ledger[0].motivo).toBe('El cajero puso 4 sellos por error');
    // Un ajuste NUNCA es forzado: forzado marca una acreditación que se saltó un límite.
    expect(ledger[0].forzado).toBe(false);
  });

  it('recorta los espacios del motivo antes de guardarlo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    await quitarPuntos(supabase, comercioId, id, 1, '   error de tecleo   ');

    const ledger = await ledgerDe(id);
    expect(ledger[0].motivo).toBe('error de tecleo');
  });

  it('rechaza cantidades no positivas o no enteras sin tocar el saldo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    for (const cantidad of [0, -1, 1.5, NaN]) {
      const res = await quitarPuntos(supabase, comercioId, id, cantidad, 'motivo válido');
      expect(res.ok).toBe(false);
    }
    expect(await saldoDe(id)).toBe(5);
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('rechaza un motivo vacío o de solo espacios', async () => {
    // El motivo obligatorio es TODA la trazabilidad del ajuste: sin él, quitar sellos sería
    // indistinguible de un borrado silencioso.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    for (const motivo of ['', '   ', '\n\t']) {
      const res = await quitarPuntos(supabase, comercioId, id, 1, motivo);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('Escribí el motivo de la corrección.');
    }
    expect(await saldoDe(id)).toBe(5);
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('rechaza un motivo más largo que el máximo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    const res = await quitarPuntos(
      supabase,
      comercioId,
      id,
      1,
      'x'.repeat(LARGO_MAXIMO_MOTIVO + 1),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(`El motivo no puede pasar de ${LARGO_MAXIMO_MOTIVO} caracteres.`);
    expect(await saldoDe(id)).toBe(5);
  });

  it('acepta un motivo de exactamente el largo máximo', async () => {
    // El borde exacto: con `>=` en vez de `>` en la validación, este caso legítimo se rechazaría.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    const res = await quitarPuntos(supabase, comercioId, id, 1, 'x'.repeat(LARGO_MAXIMO_MOTIVO));

    expect(res.ok).toBe(true);
  });

  it('NO deja el saldo negativo y devuelve cuánto hay realmente', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 3);

    const res = await quitarPuntos(supabase, comercioId, id, 5, 'me pasé');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('No se puede quitar esa cantidad: la tarjeta solo tiene 3.');
    expect(await saldoDe(id)).toBe(3); // intacta
    expect(await ledgerDe(id)).toHaveLength(0); // sin rastro de un ajuste que no ocurrió
  });

  it('permite dejar el saldo exactamente en cero', async () => {
    // El borde del guard `puntos_actuales + p_delta >= 0`: con `> 0` en vez de `>= 0`, vaciar una
    // tarjeta sería imposible.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 3);

    const res = await quitarPuntos(supabase, comercioId, id, 3, 'anular todo');

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.puntosActuales).toBe(0);
    expect(await saldoDe(id)).toBe(0);
  });

  it('NO ajusta una tarjeta de OTRO comercio', async () => {
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioA, 5);

    const res = await quitarPuntos(supabase, comercioB, id, 2, 'intento cruzado');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Esa tarjeta no existe en tu comercio.');
    expect(await saldoDe(id)).toBe(5); // intacta
  });

  it('persiste sucursal y cajero en la fila del ajuste', async () => {
    // Sin atribución, el ajuste no sirve para auditar: hay que poder decir QUIÉN lo hizo.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);
    const sucursalId = await entorno.crearSucursal(comercioId);
    const cajeroUsuarioId = await entorno.crearCajero(comercioId);

    const res = await quitarPuntos(supabase, comercioId, id, 2, 'corrección', {
      sucursalId,
      cajeroUsuarioId,
    });

    expect(res.ok).toBe(true);
    const ledger = await ledgerDe(id);
    expect(ledger[0].sucursal_id).toBe(sucursalId);
    expect(ledger[0].cajero_usuario_id).toBe(cajeroUsuarioId);
  });

  it('rechaza una sucursal de otro comercio sin tocar el saldo', async () => {
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioA, 5);
    const sucursalAjena = await entorno.crearSucursal(comercioB);

    const res = await quitarPuntos(supabase, comercioA, id, 2, 'x', { sucursalId: sucursalAjena });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('La sucursal no es válida.');
    expect(await saldoDe(id)).toBe(5);
    expect(await ledgerDe(id)).toHaveLength(0);
  });

  it('dos ajustes concurrentes no pueden dejar el saldo negativo', async () => {
    // El guard vive DENTRO del where del update (`puntos_actuales + p_delta >= 0`), así que el
    // chequeo y la escritura son la misma operación. Si alguien lo saca del where y lo pone como un
    // `if` previo con un select, esto FALLA: los dos leerían 5, los dos pasarían, y quedaría -1.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    const resultados = await Promise.all([
      quitarPuntos(supabase, comercioId, id, 3, 'uno'),
      quitarPuntos(supabase, comercioId, id, 3, 'dos'),
    ]);

    const exitosos = resultados.filter((r) => r.ok);
    expect(exitosos).toHaveLength(1);
    expect(await saldoDe(id)).toBe(2);
    expect(await ledgerDe(id)).toHaveLength(1);
  });

  it('la BD rechaza una fila de ajuste sin motivo aunque se inserte directo', async () => {
    // El candado de último recurso (CHECK transacciones_puntos_motivo_obligatorio). La defensa real
    // con mensaje en español es la capa TS; esto prueba que un camino que la esquive tampoco puede
    // dejar un ajuste huérfano de razón.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    const { error } = await supabase
      .from('transacciones_puntos')
      .insert({ tarjeta_id: id, puntos_delta: -1, tipo: 'ajuste' });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514'); // check_violation
  });

  it('la BD rechaza una acreditación forzada sin motivo aunque se inserte directo', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 5);

    const { error } = await supabase
      .from('transacciones_puntos')
      .insert({ tarjeta_id: id, puntos_delta: 1, tipo: 'acreditacion', forzado: true });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23514');
  });
});
