// Borra los comercios y las cuentas de PRUEBA que dejaron las suites viejas en la base REAL: los "Cuenta Test
// <sello>", "Cuenta Propio <sello>", "Destino <sello>", y los comercios `test-…`, `activo-…`, `cartel-…`, etc.
// (el 2026-09-21 eran 170 comercios y 21 cuentas, contra 11 comercios y 11 cuentas reales).
//
// SEGURIDAD, en capas (es un borrado permanente en la base que usan los clientes):
//   1. SIMULACRO por defecto: imprime lo que borraría y no toca nada. Solo `--confirmar` borra de verdad.
//   2. Un comercio o cuenta es de prueba SOLO si su slug/nombre cumple un patrón conocido Y lleva el sello de
//      tiempo de 13 dígitos que ponen las pruebas (`Date.now()`). Un comercio real llamado "Test Café" no lo
//      cumple.
//   3. LISTA DE PROTECCIÓN: los slugs de los pilotos y clientes reales nunca se borran, y si un patrón llegara
//      a alcanzar uno, el script aborta sin borrar nada.
//   4. Una cuenta se borra solo si quedó SIN comercios y NO tiene cobros, solicitudes de plan ni pagos.
//   5. Un comercio de prueba colgado de una cuenta que NO es de prueba se salta (y se avisa).
//   6. Tope de sensatez: si el simulacro encuentra más de lo esperado, aborta.
//
// El orden de borrado parte del de `limpiar()` en test/fixtures/entornoComercio.ts y el de
// scripts/limpiar-comercios-prueba.ts (notificaciones_enviadas y difusiones no tienen ON DELETE CASCADE), y suma
// las tres tablas con FK sin cascada que esos dos no tocan: apple_push_registrations (por tarjeta), reglas_puntos y
// niveles_descuento (por comercio). El mapa completo se armó leyendo todas las migraciones (`references …`).
//
// Uso (siempre con el simulacro primero):
//   npx tsx --conditions=react-server scripts/limpiar-datos-prueba.ts              (simulacro)
//   npx tsx --conditions=react-server scripts/limpiar-datos-prueba.ts --confirmar  (borra)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

// Comercios y cuentas REALES: nunca se tocan. Si hay uno nuevo que proteger, se agrega acá.
const SLUGS_PROTEGIDOS = new Set([
  'cafeteria-piloto',
  'cafe-aurora-demo',
  'verde-raiz-demo',
  'brasa-urbana-demo',
  'dulce-nube-demo',
  'barberia-el-puerto-demo',
  'farmacia-abc',
  'pilates-health',
  'barbiere-di-paolo',
  'segundo',
  'm-m-inversiones',
]);
const NOMBRES_CUENTA_PROTEGIDOS = new Set([
  'Cafetería Piloto',
  'Café Aurora',
  'Verde Raíz',
  'Brasa Urbana',
  'Dulce Nube',
  'Barbería El Puerto',
  'Farmacias',
  'Paulo Aldana',
  'Segundo',
  'M&M Inversiones',
  'Ban Ban',
]);

const SELLO = /\d{13}/; // Date.now() de las pruebas
const PREFIJOS_SLUG_PRUEBA = [/^test-/, /^activo-/, /^mi-segunda-marca-/, /^cash-/, /^huerfano-imposible-/, /^cartel-/];
const NOMBRES_CUENTA_PRUEBA = [/^Cuenta Test /, /^Cuenta Propio /, /^Destino( principal)? /];

const esComercioDePrueba = (slug: string) => SELLO.test(slug) && PREFIJOS_SLUG_PRUEBA.some((p) => p.test(slug));
const esCuentaDePrueba = (nombre: string) => SELLO.test(nombre) && NOMBRES_CUENTA_PRUEBA.some((p) => p.test(nombre));

// Topes de sensatez: lo que se vio el 2026-09-21, con margen. Más que esto es señal de que un patrón se pasó.
const MAX_COMERCIOS = 250;
const MAX_CUENTAS = 40;

const lotes = <T>(items: T[], n = 40): T[][] => {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += n) salida.push(items.slice(i, i + n));
  return salida;
};

async function main() {
  const confirmar = process.argv.includes('--confirmar');
  const supabase = createServiceClient();

  const { data: comercios, error: eCom } = await supabase.from('comercios').select('id, nombre, slug, cuenta_id');
  const { data: cuentas, error: eCue } = await supabase.from('cuentas_comercio').select('id, nombre');
  if (eCom || eCue || !comercios || !cuentas) {
    console.error('No se pudo leer la base:', eCom?.message ?? eCue?.message);
    process.exit(1);
  }

  const cuentaPorId = new Map(cuentas.map((c) => [c.id, c]));
  const candidatosComercio = comercios.filter((c) => esComercioDePrueba(c.slug));
  const candidatasCuenta = cuentas.filter((c) => esCuentaDePrueba(c.nombre));

  // Capa 3: ningún patrón puede alcanzar algo protegido.
  const alcanzados = [
    ...candidatosComercio.filter((c) => SLUGS_PROTEGIDOS.has(c.slug)).map((c) => `comercio /${c.slug}`),
    ...candidatasCuenta.filter((c) => NOMBRES_CUENTA_PROTEGIDOS.has(c.nombre)).map((c) => `cuenta ${c.nombre}`),
  ];
  if (alcanzados.length > 0) {
    console.error('ABORTO: un patrón alcanzó algo protegido:', alcanzados.join(', '));
    process.exit(1);
  }
  if (candidatosComercio.length > MAX_COMERCIOS || candidatasCuenta.length > MAX_CUENTAS) {
    console.error(
      `ABORTO: demasiados candidatos (${candidatosComercio.length} comercios, ${candidatasCuenta.length} cuentas). Revisá los patrones.`,
    );
    process.exit(1);
  }

  // Capa 5: un comercio de prueba colgado de una cuenta real se salta.
  const idsCuentaPrueba = new Set(candidatasCuenta.map((c) => c.id));
  const comerciosABorrar = candidatosComercio.filter((c) => {
    if (c.cuenta_id !== null && !idsCuentaPrueba.has(c.cuenta_id)) {
      const cuenta = cuentaPorId.get(c.cuenta_id);
      console.warn(`  SALTO comercio /${c.slug}: cuelga de la cuenta "${cuenta?.nombre ?? '?'}", que no es de prueba.`);
      return false;
    }
    return true;
  });
  const idsComercios = comerciosABorrar.map((c) => c.id);

  // Lo que cuelga de esos comercios.
  const tarjetaIds: string[] = [];
  const clienteCandidatos = new Set<string>();
  for (const lote of lotes(idsComercios)) {
    const { data } = await supabase.from('tarjetas').select('id, cliente_id').in('comercio_id', lote);
    for (const t of data ?? []) {
      tarjetaIds.push(t.id);
      clienteCandidatos.add(t.cliente_id);
    }
  }

  // Capa 4: una cuenta se borra solo sin comercios restantes y sin cobros / solicitudes / pagos.
  const idsComerciosABorrar = new Set(idsComercios);
  const cuentasABorrar: typeof candidatasCuenta = [];
  for (const cuenta of candidatasCuenta) {
    const restantes = comercios.filter((c) => c.cuenta_id === cuenta.id && !idsComerciosABorrar.has(c.id));
    const [{ count: cobros }, { count: solicitudes }, { count: pagos }] = await Promise.all([
      supabase.from('cobros').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuenta.id),
      supabase.from('solicitudes_plan').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuenta.id),
      supabase.from('pagos_wompi').select('id', { count: 'exact', head: true }).eq('cuenta_id', cuenta.id),
    ]);
    if (restantes.length > 0 || (cobros ?? 0) > 0 || (solicitudes ?? 0) > 0 || (pagos ?? 0) > 0) {
      console.warn(
        `  SALTO cuenta "${cuenta.nombre}": comercios que quedan=${restantes.length}, cobros=${cobros}, solicitudes=${solicitudes}, pagos=${pagos}.`,
      );
      continue;
    }
    cuentasABorrar.push(cuenta);
  }

  console.log('\nResumen de lo que se borraría:');
  console.log(`  comercios de prueba: ${comerciosABorrar.length} de ${comercios.length}`);
  console.log(`  tarjetas de esos comercios: ${tarjetaIds.length}`);
  console.log(`  clientes que solo tenían esas tarjetas (se borran si quedan sin tarjetas): hasta ${clienteCandidatos.size}`);
  console.log(`  cuentas de prueba: ${cuentasABorrar.length} de ${cuentas.length}`);
  const porPrefijo = new Map<string, number>();
  for (const c of comerciosABorrar) {
    const p = c.slug.replace(/[-\d].*$/, '') + '-…';
    porPrefijo.set(p, (porPrefijo.get(p) ?? 0) + 1);
  }
  console.log('  por prefijo de slug:', [...porPrefijo.entries()].map(([k, v]) => `${k} ${v}`).join(', '));
  console.log(`\nSe CONSERVAN ${comercios.length - comerciosABorrar.length} comercios y ${cuentas.length - cuentasABorrar.length} cuentas:`);
  for (const c of comercios.filter((c) => !idsComerciosABorrar.has(c.id))) console.log(`  comercio /${c.slug}`);
  const idsCuentasBorradas = new Set(cuentasABorrar.map((c) => c.id));
  for (const c of cuentas.filter((c) => !idsCuentasBorradas.has(c.id))) console.log(`  cuenta ${c.nombre}`);

  if (!confirmar) {
    console.log('\nSIMULACRO: no se borró nada. Si la lista de arriba es correcta, volvé a correr con --confirmar.');
    return;
  }

  // PromiseLike y no Promise: el builder de postgrest-js es thenable pero no una Promise real.
  const paso = async (tabla: string, ejecutar: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await ejecutar();
    if (error) {
      console.error(`  FALLÓ ${tabla}: ${error.message}`);
      process.exit(1);
    }
  };
  console.log('\nBorrando…');
  for (const lote of lotes(tarjetaIds)) {
    await paso('notificaciones_enviadas', () => supabase.from('notificaciones_enviadas').delete().in('tarjeta_id', lote));
    await paso('apple_push_registrations', () => supabase.from('apple_push_registrations').delete().in('tarjeta_id', lote));
  }
  for (const lote of lotes(idsComercios)) {
    await paso('difusiones', () => supabase.from('difusiones').delete().in('comercio_id', lote));
  }
  for (const lote of lotes(tarjetaIds)) {
    await paso('transacciones_puntos', () => supabase.from('transacciones_puntos').delete().in('tarjeta_id', lote));
    await paso('canjes', () => supabase.from('canjes').delete().in('tarjeta_id', lote));
  }
  for (const lote of lotes(idsComercios)) {
    await paso('usuarios_comercio', () => supabase.from('usuarios_comercio').delete().in('comercio_id', lote));
    await paso('sucursales', () => supabase.from('sucursales').delete().in('comercio_id', lote));
    await paso('recompensas', () => supabase.from('recompensas').delete().in('comercio_id', lote));
    await paso('reglas_puntos', () => supabase.from('reglas_puntos').delete().in('comercio_id', lote));
    await paso('niveles_descuento', () => supabase.from('niveles_descuento').delete().in('comercio_id', lote));
    await paso('tarjetas', () => supabase.from('tarjetas').delete().in('comercio_id', lote));
    await paso('programas_tarjeta', () => supabase.from('programas_tarjeta').delete().in('comercio_id', lote));
  }
  console.log('  hijos de los comercios: OK');

  // Un cliente solo se borra si ya no le queda NINGUNA tarjeta (podría tener una en un comercio real).
  let clientesBorrados = 0;
  for (const lote of lotes([...clienteCandidatos])) {
    const { data: conTarjeta } = await supabase.from('tarjetas').select('cliente_id').in('cliente_id', lote);
    const conservar = new Set((conTarjeta ?? []).map((t) => t.cliente_id));
    const borrables = lote.filter((id) => !conservar.has(id));
    if (borrables.length) {
      await paso('clientes', () => supabase.from('clientes').delete().in('id', borrables));
      clientesBorrados += borrables.length;
    }
  }
  console.log(`  clientes: ${clientesBorrados} borrados`);

  for (const lote of lotes(idsComercios)) {
    await paso('comercios', () => supabase.from('comercios').delete().in('id', lote));
  }
  console.log(`  comercios: ${idsComercios.length} borrados`);
  for (const cuenta of cuentasABorrar) {
    await paso('cuentas_comercio', () => supabase.from('cuentas_comercio').delete().eq('id', cuenta.id));
  }
  console.log(`  cuentas: ${cuentasABorrar.length} borradas`);

  const [{ count: quedanComercios }, { count: quedanCuentas }] = await Promise.all([
    supabase.from('comercios').select('id', { count: 'exact', head: true }),
    supabase.from('cuentas_comercio').select('id', { count: 'exact', head: true }),
  ]);
  console.log(`\nListo. Quedan ${quedanComercios} comercios y ${quedanCuentas} cuentas.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALLO GENERAL:', e);
    process.exit(1);
  });
