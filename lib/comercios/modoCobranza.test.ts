import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { hoyEnZona } from '../tarjetas/vigencia';
import type { Database } from '../supabase/types';
import { cambiarModoCobranza, posponerPago, perdonarCiclo, METODO_PERDONADO_FM } from './modoCobranza';

// Migración 0038 aplicada (cuentas_comercio.cobranza). Ver
// docs/superpowers/plans/2026-09-21-cobranza-y-rework-admin.md.
//
// El archivo corre completo y en verde contra Supabase real (.env.local).
//
// MUTATION-TESTING (cada fila se corrió el 2026-09-22 contra Supabase: romper la línea, ver fallar
// con ESE test, restaurar — confirmadas, no solo razonadas):
//   - cambiarModoCobranza a 'normal' no fija cobranza_desde (lo deja en null o en el valor viejo)
//       → falla "pasar a 'normal' fija cobranza_desde en la fecha de hoy"
//   - cambiarModoCobranza a 'exenta' no limpia cobranza_pospuesta_hasta (o solo cambia `cobranza`)
//       → falla "pasar a 'exenta' limpia una posposición existente"
//   - cambiarModoCobranza deja de validar `modo` contra VALORES_COBRANZA (deja pasar cualquier string)
//       → falla "rechaza un modo de cobranza inválido" — pero NO por un 23514 crudo de la BD como se
//         había razonado sin correrlo: `cambios` sale de un ternario que SOLO escribe los literales
//         'normal'/'exenta' según `modo === 'normal'`, así que un `modo` inválido ('premium') nunca
//         llega a la columna tal cual — cae en la rama `else` y graba 'exenta' (un valor VÁLIDO). El
//         update pasa igual (`res.ok: true`) y `expect(res.ok).toBe(false)` falla de entrada
//         ("expected true to be false"), antes de comparar ningún mensaje — y la fila SÍ queda
//         tocada (pasa a 'exenta'), que es lo que el resto del test verifica. Confirmado corriendo.
//   - posponerPago no manda `cobranza_pospuesta_hasta` al update (o lo manda `undefined`, que
//     Supabase/JSON.stringify elimina del payload y lo deja en `{}`)
//       → falla "guarda una fecha de posposición" — pero NO como un no-op silencioso que deja la
//         columna intacta, como se había razonado sin correrlo: un PATCH con body `{}` hace que
//         PostgREST no matchee ninguna fila para el `.select('id').single()` (PGRST116, "Cannot
//         coerce the result to a single JSON object"), así que `res.ok` da `false` con "Esa cuenta ya
//         no existe." — el test igual falla en `expect(res.ok).toBe(true)`, solo que por ese camino.
//   - posponerPago convierte `null` en otra cosa antes del update (ej. `hasta ?? undefined`, que
//     también desaparece del payload y deja el PATCH con body `{}`)
//       → falla "quita la posposición cuando hasta es null" por el mismo PGRST116 de arriba (no un
//         no-op que deje la columna intacta, como se había razonado sin correrlo)
//   - posponerPago deja de validar el formato de `hasta` (deja pasar cualquier string a la columna
//     `date`, que Postgres rechazaría con un error de tipo crudo, no con el mensaje de este test)
//       → falla "rechaza una fecha de posposición con formato inválido"
//   - perdonarCiclo calcula el ciclo desde `cobranza_desde` aunque SÍ haya un período ya pagado (no
//     usa `cubiertoHasta`)
//       → falla "perdona el ciclo siguiente al último período pagado" (periodo_desde/periodo_hasta
//         esperados no coinciden con los que saldrían de cobranza_desde)
//   - perdonarCiclo calcula el ciclo desde `hoy` en vez de `cobranza_desde` cuando la cuenta nunca
//     pagó (period_desde equivocado)
//       → falla "perdona el primer ciclo (cobranza_desde) cuando la cuenta nunca pagó"
//   - perdonarCiclo no manda `monto: 0` (ej. manda el monto del plan, o del período anterior)
//       → fallan las dos pruebas de perdonarCiclo (ambas verifican `monto === 0`)
//   - perdonarCiclo no manda `metodo: 'Perdonado por FM'` (ej. reusa METODO_WOMPI o METODO_PEDIDO_FM)
//       → fallan las dos pruebas de perdonarCiclo (ambas verifican el `metodo` exacto)
//   - perdonarCiclo manda `estado: 'pendiente'` (o `pagado_en: null`) en vez de `pagado`/`hoy`
//       → fallan las dos pruebas de perdonarCiclo — y de hecho `registrarCobro`/`validarCobro` ya
//         rechazaría esa combinación en runtime con "Un cobro marcado como pagado necesita su fecha
//         de pago." si `estado: 'pagado'` viajara sin `pagadoEn`, así que esta mutación concreta
//         (estado pendiente pero con pagado_en igual) es la que de verdad hay que vigilar
//   - perdonarCiclo llama a `notificarPagoAMeta` (no está en el alcance de esta función, pero si
//     alguien lo agrega por "consistencia" con las otras acciones de FM, ninguna prueba de ESTE
//     archivo lo detectaría — queda anotado acá para que quien revise sepa que hay que verificarlo
//     leyendo el código, no una prueba, porque perdonarCiclo no recibe ni el cliente de Meta ni un
//     mock: no lo importa, así que agregarlo sería un import nuevo visible a simple vista)
//   - cambiarModoCobranza/posponerPago le sacan el `.select('id').single()` al `.update().eq()`
//     (revisión de calidad sobre el commit 2dfb824, verificada por el controlador línea por línea
//     antes de pedir el fix): sin eso, PostgREST no distingue "actualicé 0 filas" de "actualicé 1" —
//     un `cuentaId` que no corresponde a ninguna fila (typo, o borrada en una carrera con
//     `eliminarCuenta`) devuelve éxito igual, sin haber tocado nada
//       → fallan "rechaza un cuentaId que no existe, en vez de reportar éxito" en AMBOS describe
//         (cambiarModoCobranza y posponerPago) — mismo patrón que `actualizarCuenta` en
//         cuentas.ts/cuentas.test.ts:348 ("falla si la cuenta ya no existe, en vez de reportar éxito")

const supabase = createServiceClient();
const cuentasDePrueba: string[] = [];
const cobrosDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: cobros (vía cuenta_id) → cuentas_comercio.
  if (cobrosDePrueba.length) {
    const { error } = await supabase.from('cobros').delete().in('id', cobrosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los cobros de prueba:', error);
    cobrosDePrueba.length = 0;
  }
  if (cuentasDePrueba.length) {
    const { error } = await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las cuentas de prueba:', error);
    cuentasDePrueba.length = 0;
  }
});

async function crearCuentaFixture(opciones?: {
  cobranza?: 'normal' | 'exenta';
  cobranzaDesde?: string;
  cobranzaPospuestaHasta?: string | null;
}): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const insert: Database['public']['Tables']['cuentas_comercio']['Insert'] = {
    nombre: `Cuenta Cobranza Test ${sufijo}`,
  };
  if (opciones?.cobranza !== undefined) insert.cobranza = opciones.cobranza;
  if (opciones?.cobranzaDesde !== undefined) insert.cobranza_desde = opciones.cobranzaDesde;
  if (opciones?.cobranzaPospuestaHasta !== undefined) {
    insert.cobranza_pospuesta_hasta = opciones.cobranzaPospuestaHasta;
  }

  const { data, error } = await supabase.from('cuentas_comercio').insert(insert).select('id').single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

// Un período YA pagado (por Wompi, no relevante para esta prueba): lo que le importa a
// `perdonarCiclo` es que exista un cobro `pagado`/`tipo: 'periodo'` con estas fechas, que es lo que
// lee `listarPeriodosPagados`.
async function crearPeriodoPagadoFixture(cuentaId: string, desde: string, hasta: string): Promise<void> {
  const { data, error } = await supabase
    .from('cobros')
    .insert({
      cuenta_id: cuentaId,
      tipo: 'periodo',
      periodo_desde: desde,
      periodo_hasta: hasta,
      monto: 29,
      estado: 'pagado',
      metodo: 'Wompi',
      pagado_en: desde,
    })
    .select('id')
    .single();
  if (error) throw error;
  cobrosDePrueba.push(data.id);
}

describe('cambiarModoCobranza', () => {
  it("pasar a 'normal' fija cobranza_desde en la fecha de hoy", async () => {
    const cuentaId = await crearCuentaFixture({ cobranza: 'exenta', cobranzaDesde: '2020-01-01' });

    const res = await cambiarModoCobranza(supabase, cuentaId, 'normal');

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('cobranza, cobranza_desde')
      .eq('id', cuentaId)
      .single();
    expect(data!.cobranza).toBe('normal');
    expect(data!.cobranza_desde).toBe(hoyEnZona('America/El_Salvador'));
  });

  it("pasar a 'exenta' limpia una posposición existente", async () => {
    const cuentaId = await crearCuentaFixture({ cobranza: 'normal', cobranzaPospuestaHasta: '2026-12-31' });

    const res = await cambiarModoCobranza(supabase, cuentaId, 'exenta');

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('cobranza, cobranza_pospuesta_hasta')
      .eq('id', cuentaId)
      .single();
    expect(data!.cobranza).toBe('exenta');
    expect(data!.cobranza_pospuesta_hasta).toBeNull();
  });

  it('rechaza un modo de cobranza inválido y no toca la fila', async () => {
    const cuentaId = await crearCuentaFixture(); // nace 'normal' (default de la migración 0038)

    const res = await cambiarModoCobranza(supabase, cuentaId, 'premium');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('El modo de cobranza debe ser "normal" o "exenta".');
    const { data } = await supabase.from('cuentas_comercio').select('cobranza').eq('id', cuentaId).single();
    expect(data!.cobranza).toBe('normal');
  });

  it('rechaza un cuentaId que no existe, en vez de reportar éxito', async () => {
    // Mismo caso que actualizarCuenta (cuentas.ts) / cuentas.test.ts:348: un UUID con formato válido
    // pero que no es de ninguna fila real. Sin el .select('id').single() del update, esto devolvía
    // { ok: true } sin haber tocado nada — el hueco que encontró la revisión de calidad del commit
    // 2dfb824.
    const res = await cambiarModoCobranza(supabase, '00000000-0000-0000-0000-000000000000', 'normal');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Esa cuenta ya no existe.');
  });
});

describe('posponerPago', () => {
  it('guarda una fecha de posposición', async () => {
    const cuentaId = await crearCuentaFixture();

    const res = await posponerPago(supabase, cuentaId, '2026-12-31');

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('cobranza_pospuesta_hasta')
      .eq('id', cuentaId)
      .single();
    expect(data!.cobranza_pospuesta_hasta).toBe('2026-12-31');
  });

  it('quita la posposición cuando hasta es null', async () => {
    const cuentaId = await crearCuentaFixture({ cobranzaPospuestaHasta: '2026-10-01' });

    const res = await posponerPago(supabase, cuentaId, null);

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('cobranza_pospuesta_hasta')
      .eq('id', cuentaId)
      .single();
    expect(data!.cobranza_pospuesta_hasta).toBeNull();
  });

  it('rechaza una fecha de posposición con formato inválido', async () => {
    const cuentaId = await crearCuentaFixture();

    const res = await posponerPago(supabase, cuentaId, '31/12/2026');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('La fecha de posposición debe tener el formato AAAA-MM-DD.');
  });

  it('rechaza un cuentaId que no existe, en vez de reportar éxito', async () => {
    // Mismo caso y mismo motivo que el test análogo de cambiarModoCobranza, arriba.
    const res = await posponerPago(supabase, '00000000-0000-0000-0000-000000000000', '2026-12-31');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Esa cuenta ya no existe.');
  });
});

describe('perdonarCiclo', () => {
  it('perdona el ciclo siguiente al último período pagado', async () => {
    const cuentaId = await crearCuentaFixture({ cobranzaDesde: '2026-01-01' });
    await crearPeriodoPagadoFixture(cuentaId, '2026-07-01', '2026-07-31');

    const res = await perdonarCiclo(supabase, cuentaId, '2026-09-10');

    expect(res.ok).toBe(true);
    if (res.ok) {
      cobrosDePrueba.push(res.id);
      const { data } = await supabase.from('cobros').select('*').eq('id', res.id).single();
      // El ciclo que venció arranca el día SIGUIENTE al último período pagado (2026-07-31 → 08-01),
      // no en cobranza_desde (2026-01-01): esta cuenta SÍ pagó antes.
      expect(data!.periodo_desde).toBe('2026-08-01');
      expect(data!.periodo_hasta).toBe('2026-08-31');
      expect(Number(data!.monto)).toBe(0);
      expect(data!.estado).toBe('pagado');
      expect(data!.metodo).toBe(METODO_PERDONADO_FM);
      expect(data!.pagado_en).toBe('2026-09-10');
      expect(data!.tipo).toBe('periodo');
    }
  });

  it('perdona el primer ciclo (cobranza_desde) cuando la cuenta nunca pagó', async () => {
    const cuentaId = await crearCuentaFixture({ cobranzaDesde: '2026-08-05' });
    // Sin ningún cobro `pagado` para esta cuenta: listarPeriodosPagados devuelve [].

    const res = await perdonarCiclo(supabase, cuentaId, '2026-09-10');

    expect(res.ok).toBe(true);
    if (res.ok) {
      cobrosDePrueba.push(res.id);
      const { data } = await supabase.from('cobros').select('*').eq('id', res.id).single();
      // Nunca pagó: el ciclo perdonado arranca en cobranza_desde (2026-08-05), no en `hoy`.
      // hastaDelPeriodo('2026-08-05') = un mes calendario después menos un día = 2026-09-04.
      expect(data!.periodo_desde).toBe('2026-08-05');
      expect(data!.periodo_hasta).toBe('2026-09-04');
      expect(Number(data!.monto)).toBe(0);
      expect(data!.estado).toBe('pagado');
      expect(data!.metodo).toBe(METODO_PERDONADO_FM);
      expect(data!.pagado_en).toBe('2026-09-10');
    }
  });
});
