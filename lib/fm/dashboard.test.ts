import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import type { Database } from '../supabase/types';
import {
  actividadReciente,
  contarCuentasEnRiesgo,
  contarSolicitudesPendientes,
  ingresosDelMes,
  tamanoDeCartera,
} from './dashboard';

// Las 5 funciones de dashboard.ts, contra Supabase real (.env.local). `fusionarActividad` (la pura
// que ordena/recorta) se prueba en actividad.test.ts.
//
// `contarCuentasEnRiesgo` (describe al final de este archivo) dependía de la migración 0038
// (cuentas_comercio.cobranza/cobranza_desde/cobranza_pospuesta_hasta) y corría SIN CORRER hasta acá
// — Daniel la aplicó contra la base real (Tarea 11) y este describe corre y está verde igual que los
// otros 4, verificado el 2026-09-22 con el archivo COMPLETO (ya no hace falta acotar con `vitest -t`).
//
// La base es compartida — mismo criterio que pagosAdminDb.test.ts / iniciarPagoPlanSupabase.test.ts:
// los conteos se comparan contra lo que había ANTES ("antes/después"), nunca contra un total
// absoluto. Los fixtures de `actividadReciente` nacen con `created_at` deliberadamente MUY en el
// futuro (año 2200) para quedar garantizados dentro del `.limit(5)` de cada fuente sin importar
// cuánta actividad real (o de otra prueba corriendo contra la misma base) sea más reciente.
//
// MUTATION-TESTING (cada fila se corrió el 2026-09-22 contra Supabase: romper, ver fallar con ESE
// test, restaurar):
//   - ingresosDelMes deja de filtrar `estado = 'pagado'`: NO se pudo matar con datos reales — el
//     CHECK de la migración 0017 (`(estado = 'pagado') = (pagado_en is not null)`) garantiza que
//     CUALQUIER fila con `pagado_en` en el rango YA tiene `estado = 'pagado'`, así que quitar el
//     filtro da el mismo resultado hoy. Se deja el filtro explícito de todas formas (así lo pide la
//     spec, y protege si el CHECK cambiara), pero es honesto no reclamar una prueba que no lo mata.
//   - ingresosDelMes no filtra el piso del mes (`gte`)         → falla "excluye un pago de antes del mes"
//   - ingresosDelMes no filtra el techo (`lte hoy`)            → falla "excluye un pago posterior a `hoy`"
//   - ingresosDelMes calcula el primer día del mes con `new Date()` del servidor en vez de `hoy`
//       → falla "usa el mes de `hoy`, no el reloj del servidor"
//   - ingresosDelMes devuelve 0 en vez de null ante un error   → falla "devuelve null ante un error de lectura"
//   - tamanoDeCartera cruza dos de los tres conteos (p. ej. devuelve `comercios` donde va `clientes`)
//       → falla "cuenta cuentas, comercios y clientes por separado" — el fixture crea 1/2/3 a
//         propósito (cantidades DISTINTAS): con las tres en +1 esta mutación no se detecta (se
//         comprobó: con deltas iguales, el cruce pasó en verde por error)
//   - tamanoDeCartera devuelve un objeto parcial si SOLO una de las tres consultas falla (revisa nada
//     más `cuentas.error`, por ejemplo, e ignora `comercios.error`/`clientes.error`)
//       → falla "devuelve null si CUALQUIERA de los tres conteos falla" (la prueba recorre las tres)
//   - contarSolicitudesPendientes cuenta también las resueltas → falla "sube con una solicitud pendiente…"
//   - contarSolicitudesPendientes devuelve 0 en vez de null ante un error
//       → falla "devuelve null ante un error de lectura"
//   - actividadReciente no filtra `conciliacion = 'aplicado'` en pagos_wompi
//       → falla "junta las tres fuentes…" (el pago sin aplicar aparecería primero)
//   - actividadReciente ignora el `limite` recibido (usa uno fijo)
//       → falla "recorta al límite pedido (no siempre 5)"
//   - actividadReciente devuelve lo que sí pudo leer si falla UNA de las tres consultas, en vez de null
//       → falla "devuelve null si cualquiera de las tres consultas falla" (la prueba recorre las tres)

const supabase = createServiceClient();
const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const pagosDePrueba: string[] = [];
const solicitudesDePrueba: string[] = [];
const cobrosDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const comerciosDePrueba: string[] = [];
const cuentasDePrueba: string[] = [];

// Orden por FK: pagos_wompi/solicitudes_plan/cobros/comercios (referencian cuenta) → cuentas_comercio.
// clientes no depende de ninguna, puede ir en cualquier momento.
afterEach(async () => {
  if (pagosDePrueba.length) await supabase.from('pagos_wompi').delete().in('id', pagosDePrueba.splice(0));
  if (solicitudesDePrueba.length) await supabase.from('solicitudes_plan').delete().in('id', solicitudesDePrueba.splice(0));
  if (cobrosDePrueba.length) await supabase.from('cobros').delete().in('id', cobrosDePrueba.splice(0));
  if (clientesDePrueba.length) await supabase.from('clientes').delete().in('id', clientesDePrueba.splice(0));
  if (comerciosDePrueba.length) await supabase.from('comercios').delete().in('id', comerciosDePrueba.splice(0));
  if (cuentasDePrueba.length) await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba.splice(0));
});

async function crearCuenta(campos: Partial<Database['public']['Tables']['cuentas_comercio']['Insert']> = {}): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Dashboard ${sufijo()}`, ...campos })
    .select('id')
    .single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercio(cuentaId: string): Promise<string> {
  const s = sufijo();
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: `Comercio Dashboard ${s}`, slug: `dashboard-${s}`, cuenta_id: cuentaId })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearCliente(): Promise<string> {
  const { data, error } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Dashboard', telefono: `+503${sufijo()}` })
    .select('id')
    .single();
  if (error) throw error;
  clientesDePrueba.push(data.id);
  return data.id;
}

async function crearCobro(cuentaId: string, campos: Partial<Database['public']['Tables']['cobros']['Insert']> = {}): Promise<string> {
  const { data, error } = await supabase
    .from('cobros')
    .insert({ cuenta_id: cuentaId, periodo_desde: '2026-01-01', periodo_hasta: '2026-01-31', monto: 29, ...campos })
    .select('id')
    .single();
  if (error) throw error;
  cobrosDePrueba.push(data.id);
  return data.id;
}

async function crearPago(campos: Partial<Database['public']['Tables']['pagos_wompi']['Insert']> = {}): Promise<string> {
  const idTransaccion = `tx-dashboard-${sufijo()}`;
  const { data, error } = await supabase
    .from('pagos_wompi')
    .insert({
      id_transaccion: idTransaccion,
      fuente: 'webhook',
      conciliacion: 'aplicado',
      monto: 10,
      es_real: true,
      payload: { IdTransaccion: idTransaccion },
      ...campos,
    })
    .select('id')
    .single();
  if (error) throw error;
  pagosDePrueba.push(data.id);
  return data.id;
}

async function crearSolicitud(
  cuentaId: string,
  campos: Partial<Database['public']['Tables']['solicitudes_plan']['Insert']> = {},
): Promise<string> {
  const { data, error } = await supabase
    .from('solicitudes_plan')
    .insert({ cuenta_id: cuentaId, plan_actual: 'starter', plan_solicitado: 'growth', ...campos })
    .select('id')
    .single();
  if (error) throw error;
  solicitudesDePrueba.push(data.id);
  return data.id;
}

type NombreTabla = keyof Database['public']['Tables'];

// Fuerza un error de Postgrest en las tablas nombradas; el resto de las consultas viajan al cliente
// real. `tamanoDeCartera`, `contarSolicitudesPendientes` y `actividadReciente` no reciben ningún
// input del llamador que Postgrest pueda rechazar por sí solo (son conteos/selects sin filtros
// externos) — a diferencia de `ingresosDelMes`, cuyo test de error usa una fecha inválida de verdad
// (ver abajo). Es el mismo atajo que `fallido as never` en iniciarPagoPlanSupabase.test.ts: un objeto
// que solo implementa lo que la función bajo prueba realmente llama (`.from().select()...`), para
// ejercer el branch de error DE VERDAD (la función corre y toma la rama real de `if (x.error)`), no
// una lectura del código.
function clienteQueFallaEn(tablas: NombreTabla[]) {
  const builderQueFalla = {
    select: () => builderQueFalla,
    eq: () => builderQueFalla,
    gte: () => builderQueFalla,
    lte: () => builderQueFalla,
    order: () => builderQueFalla,
    limit: () => builderQueFalla,
    then: (resolve: (v: { data: null; count: null; error: { message: string } }) => void) =>
      resolve({ data: null, count: null, error: { message: 'forzado por la prueba' } }),
  };
  return {
    from: (tabla: NombreTabla) => (tablas.includes(tabla) ? builderQueFalla : supabase.from(tabla)),
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe('ingresosDelMes', () => {
  it("suma los cobros 'pagado' dentro del mes de hoy", async () => {
    const cuentaId = await crearCuenta();
    const hoy = '2026-09-22';
    const antes = (await ingresosDelMes(supabase, hoy))!;

    await crearCobro(cuentaId, {
      periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30', monto: 49, estado: 'pagado', pagado_en: '2026-09-10',
    });

    expect(await ingresosDelMes(supabase, hoy)).toBe(antes + 49);
  });

  it("solo suma los cobros con estado 'pagado'", async () => {
    const cuentaId = await crearCuenta();
    const hoy = '2026-09-22';
    const antes = (await ingresosDelMes(supabase, hoy))!;

    await crearCobro(cuentaId, { periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30', monto: 49, estado: 'pendiente' });
    await crearCobro(cuentaId, { periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30', monto: 20, estado: 'anulado' });

    expect(await ingresosDelMes(supabase, hoy)).toBe(antes);
  });

  it('excluye un pago de antes del mes', async () => {
    const cuentaId = await crearCuenta();
    const hoy = '2026-09-22';
    const antes = (await ingresosDelMes(supabase, hoy))!;

    await crearCobro(cuentaId, {
      periodo_desde: '2026-08-01', periodo_hasta: '2026-08-31', monto: 49, estado: 'pagado', pagado_en: '2026-08-31',
    });

    expect(await ingresosDelMes(supabase, hoy)).toBe(antes);
  });

  it('excluye un pago posterior a `hoy`', async () => {
    const cuentaId = await crearCuenta();
    const hoy = '2026-09-10';
    const antes = (await ingresosDelMes(supabase, hoy))!;

    await crearCobro(cuentaId, {
      periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30', monto: 49, estado: 'pagado', pagado_en: '2026-09-15',
    });

    expect(await ingresosDelMes(supabase, hoy)).toBe(antes);
  });

  it('usa el mes de `hoy`, no el reloj del servidor', async () => {
    const cuentaId = await crearCuenta();
    // 2020, muy lejos de la fecha real en que corre esta prueba (2026): si la función calculara el
    // primer día del mes con `new Date()` en vez de con `hoy`, el piso quedaría en 2026-09-01 (mayor
    // que el techo, 2020-06-15) y esta suma daría 0 en vez del monto del cobro.
    const hoy = '2020-06-15';
    const antes = (await ingresosDelMes(supabase, hoy))!;

    await crearCobro(cuentaId, {
      periodo_desde: '2020-06-01', periodo_hasta: '2020-06-30', monto: 33, estado: 'pagado', pagado_en: '2020-06-01',
    });

    expect(await ingresosDelMes(supabase, hoy)).toBe(antes + 33);
  });

  it('devuelve null ante un error de lectura (fecha inválida), no 0', async () => {
    expect(await ingresosDelMes(supabase, 'no-es-una-fecha')).toBeNull();
  });
});

describe('tamanoDeCartera', () => {
  it('cuenta cuentas, comercios y clientes por separado', async () => {
    const antes = (await tamanoDeCartera(supabase))!;

    // Cantidades DISTINTAS a propósito (1 cuenta, 2 comercios, 3 clientes): con las tres en +1 una
    // mutación que cruzara `comercios`↔`clientes` (o cualquier otro par) daría el mismo total y no
    // la atraparía ningún test — con deltas distintos, sí.
    const cuentaId = await crearCuenta();
    await crearComercio(cuentaId);
    await crearComercio(cuentaId);
    await crearCliente();
    await crearCliente();
    await crearCliente();

    expect(await tamanoDeCartera(supabase)).toEqual({
      cuentas: antes.cuentas + 1,
      comercios: antes.comercios + 2,
      clientes: antes.clientes + 3,
    });
  });

  it('devuelve null si CUALQUIERA de los tres conteos falla, no un objeto parcial', async () => {
    for (const tabla of ['cuentas_comercio', 'comercios', 'clientes'] as const) {
      expect(await tamanoDeCartera(clienteQueFallaEn([tabla])), `falló al forzar error en ${tabla}`).toBeNull();
    }
  });
});

describe('contarSolicitudesPendientes', () => {
  it('sube con una solicitud pendiente y no cuenta las resueltas', async () => {
    const antes = (await contarSolicitudesPendientes(supabase))!;

    const cuentaId = await crearCuenta();
    await crearSolicitud(cuentaId); // 'pendiente' por defecto (migración 0017)
    expect(await contarSolicitudesPendientes(supabase)).toBe(antes + 1);

    // Otra cuenta, para no chocar con el índice "una pendiente por cuenta" (solicitudes_plan_una_pendiente).
    const otraCuentaId = await crearCuenta();
    await crearSolicitud(otraCuentaId, { estado: 'aprobada', resuelta_en: new Date().toISOString() });
    expect(await contarSolicitudesPendientes(supabase)).toBe(antes + 1);
  });

  it('devuelve null ante un error de lectura, no 0', async () => {
    expect(await contarSolicitudesPendientes(clienteQueFallaEn(['solicitudes_plan']))).toBeNull();
  });
});

describe('actividadReciente', () => {
  it('junta las tres fuentes con sus datos propios, ya fusionadas y ordenadas', async () => {
    // Fechas muy en el futuro y estrictamente crecientes: quedan garantizadas en el tope del
    // `.limit(5)` de cada fuente y su orden relativo entre sí es determinista.
    const t = new Date('2200-01-01T00:00:00Z').getTime();
    const fechaCuenta = new Date(t).toISOString();
    const fechaPagoSinAplicar = new Date(t + 500).toISOString();
    const fechaPago = new Date(t + 1000).toISOString();
    const fechaSolicitud = new Date(t + 2000).toISOString();

    const cuentaId = await crearCuenta({ created_at: fechaCuenta });
    // Un pago SIN aplicar, más reciente que el aplicado: no debe aparecer (conciliacion != 'aplicado').
    await crearPago({ cuenta_id: cuentaId, conciliacion: 'pendiente', created_at: fechaPagoSinAplicar });
    await crearPago({ cuenta_id: cuentaId, monto: 77, created_at: fechaPago });
    await crearSolicitud(cuentaId, { created_at: fechaSolicitud });

    const { data: cuenta } = await supabase.from('cuentas_comercio').select('nombre').eq('id', cuentaId).single();

    const r = (await actividadReciente(supabase, 3))!;

    // `fecha` viaja como texto: Postgrest la devuelve con offset "+00:00", no con el sufijo "Z" que
    // usa `Date.prototype.toISOString()` — mismo instante, otra representación de texto. Se compara
    // por INSTANTE (`new Date(...).getTime()`), no por igualdad de string.
    expect(r).toHaveLength(3);
    expect(r.map((e) => new Date(e.fecha).getTime())).toEqual([
      new Date(fechaSolicitud).getTime(),
      new Date(fechaPago).getTime(),
      new Date(fechaCuenta).getTime(),
    ]);
    expect(r[0]).toMatchObject({ tipo: 'solicitud', cuentaId, cuentaNombre: cuenta!.nombre, planSolicitado: 'growth' });
    expect(r[1]).toMatchObject({ tipo: 'pago', cuentaId, cuentaNombre: cuenta!.nombre, monto: 77 });
    expect(r[2]).toMatchObject({ tipo: 'cuenta_nueva', cuentaId, cuentaNombre: cuenta!.nombre });
  });

  it('recorta al límite pedido (no siempre 5)', async () => {
    const t = new Date('2200-02-01T00:00:00Z').getTime();
    const cuentaId = await crearCuenta({ created_at: new Date(t).toISOString() });
    await crearPago({ cuenta_id: cuentaId, created_at: new Date(t + 1000).toISOString() });
    await crearSolicitud(cuentaId, { created_at: new Date(t + 2000).toISOString() });

    const r = (await actividadReciente(supabase, 1))!;

    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe('solicitud'); // la más reciente de las tres
  });

  it('devuelve null si cualquiera de las tres consultas falla, no lo que sí pudo leer', async () => {
    for (const tabla of ['pagos_wompi', 'cuentas_comercio', 'solicitudes_plan'] as const) {
      expect(await actividadReciente(clienteQueFallaEn([tabla]), 5), `falló al forzar error en ${tabla}`).toBeNull();
    }
  });
});

// Necesitaba la migración 0038 (cuentas_comercio.cobranza) — Daniel la aplicó contra la base real
// (Tarea 11, 2026-09-22). Este describe (antes SIN CORRER) ya corre igual que los otros 4 de este
// archivo, verificado con el archivo COMPLETO. La lógica de conteo vive ahora en
// `estadosDeCobranzaPorCuenta` (dashboard.ts), reusada por `contarCuentasEnRiesgo` — las mutaciones
// de abajo apuntan a esa lógica compartida, ejercitada acá a través de `contarCuentasEnRiesgo`.
//
// MUTATION-TESTING (cada fila se corrió el 2026-09-22 contra Supabase: romper, ver fallar con ESE
// test, restaurar):
//   - contarCuentasEnRiesgo no cuenta 'vencida' (solo 'bloqueada')
//       → falla "cuenta las vencidas y las bloqueadas, no solo las bloqueadas"
//   - contarCuentasEnRiesgo hace una consulta de cobros POR CUENTA en vez de traer todos los
//     `pagado`/`periodo` de una vez y armar el mapa en memoria (una consulta N+1)
//       → no lo atraparía una aserción sobre el RESULTADO (el conteo sale igual); es el motivo por el
//         que la tarea pide DOS consultas explícitamente — se verifica leyendo el código, no con una
//         prueba de resultado
//   - contarCuentasEnRiesgo no filtra `cobros.tipo = 'periodo'` (cuenta también los 'ajuste')
//       → falla "un ajuste pagado no cuenta como período: una cuenta con un ajuste pero sin período
//         pagado sigue vencida"
//   - contarCuentasEnRiesgo no filtra `cobros.estado = 'pagado'` (cuenta períodos pendientes/anulados)
//       → falla "un cobro pendiente no cuenta como período pagado: la cuenta sigue vencida"
//   - contarCuentasEnRiesgo ignora `licencia_estado` (no usa `estadoEfectivo`, usa `estadoDeCobranza`
//     directo) → falla "una cuenta con licencia_estado inactivo cuenta como bloqueada, sin importar fechas"
//   - contarCuentasEnRiesgo devuelve 0 en vez de null si CUALQUIERA de las dos consultas falla
//       → falla "devuelve null si cualquiera de las dos consultas falla"
describe('contarCuentasEnRiesgo', () => {
  // "antes/después", como el resto del archivo: la tabla es compartida (una vez aplicada la 0038,
  // va a haber cuentas reales vencidas/bloqueadas), así que un `toBe(2)` absoluto sería frágil.
  it('cuenta las vencidas y las bloqueadas, no solo las bloqueadas', async () => {
    const hoy = '2026-09-22';
    const antes = (await contarCuentasEnRiesgo(supabase, hoy))!;

    // Sin ningún cobro 'periodo'/'pagado': vencida desde `cobranza_desde`. `'2026-09-10'` son 12 días
    // antes de `hoy` (diasInclusive('2026-09-10','2026-09-22') - 1 = 12), DENTRO de los 15 días de
    // gracia (DIAS_GRACIA_COBRANZA) → 'vencida', no 'bloqueada'. Tiene que caer en esta rama para que
    // la mutación "no contar 'vencida', solo 'bloqueada'" haga fallar este test — con las dos cuentas
    // del fixture en 'bloqueada' (como estaba antes), esa mutación pasaba en verde sin que nadie lo
    // notara.
    await crearCuenta({ cobranza: 'normal', cobranza_desde: '2026-09-10' }); // vencida
    // Muy por encima de los 15 días de gracia → 'bloqueada'.
    await crearCuenta({ cobranza: 'normal', cobranza_desde: '2020-01-01' }); // bloqueada
    const alDia = await crearCuenta({ cobranza: 'normal', cobranza_desde: hoy });
    await crearCobro(alDia, {
      tipo: 'periodo', estado: 'pagado', periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30', pagado_en: '2026-09-01',
    });
    await crearCuenta({ cobranza: 'exenta' }); // exenta

    // +2: vencida + bloqueada, no alDia ni exenta.
    expect(await contarCuentasEnRiesgo(supabase, hoy)).toBe(antes + 2);
  });

  it('un ajuste pagado no cuenta como período: una cuenta con un ajuste pero sin período pagado sigue vencida', async () => {
    const hoy = '2026-09-22';
    const antes = (await contarCuentasEnRiesgo(supabase, hoy))!;
    const cuentaId = await crearCuenta({ cobranza: 'normal', cobranza_desde: '2026-08-01' });
    await crearCobro(cuentaId, {
      tipo: 'ajuste', plan_destino: 'growth', estado: 'pagado', periodo_desde: hoy, periodo_hasta: hoy, pagado_en: hoy,
    });

    expect(await contarCuentasEnRiesgo(supabase, hoy)).toBe(antes + 1); // el ajuste no la puso al día
  });

  it('un cobro pendiente no cuenta como período pagado: la cuenta sigue vencida', async () => {
    const hoy = '2026-09-22';
    const antes = (await contarCuentasEnRiesgo(supabase, hoy))!;
    const cuentaId = await crearCuenta({ cobranza: 'normal', cobranza_desde: '2026-08-01' });
    await crearCobro(cuentaId, {
      tipo: 'periodo', estado: 'pendiente', periodo_desde: '2026-09-01', periodo_hasta: '2026-09-30',
    });

    expect(await contarCuentasEnRiesgo(supabase, hoy)).toBe(antes + 1);
  });

  it('una cuenta con licencia_estado inactivo cuenta como bloqueada, sin importar fechas', async () => {
    const hoy = '2026-09-22';
    const antes = (await contarCuentasEnRiesgo(supabase, hoy))!;
    // 'exenta' + licencia inactiva: sin el corte manual (estadoEfectivo), esta cuenta daría 'exenta'
    // y NO contaría. Con él, 'inactivo' pisa a 'exenta' y cuenta como bloqueada.
    await crearCuenta({ cobranza: 'exenta', licencia_estado: 'inactivo' });

    expect(await contarCuentasEnRiesgo(supabase, hoy)).toBe(antes + 1);
  });

  it('devuelve null si cualquiera de las dos consultas falla', async () => {
    for (const tabla of ['cuentas_comercio', 'cobros'] as const) {
      expect(await contarCuentasEnRiesgo(clienteQueFallaEn([tabla]), '2026-09-22'), `falló al forzar error en ${tabla}`).toBeNull();
    }
  });
});
