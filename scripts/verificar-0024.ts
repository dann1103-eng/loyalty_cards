// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0024.ts
// Verificación de la migración 0024 (programas de tarjeta). Lee datos reales (solo lectura) y
// además crea datos propios para probar los constraints — los borra al final.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

let fallas = 0;
const ok = (m: string) => console.log(`OK: ${m}`);
const fallo = (m: string, d?: string) => {
  console.error(`FALLO: ${m}${d ? ` — ${d}` : ''}`);
  fallas += 1;
};

async function main() {
  const supabase = createServiceClient();

  // ── 1. Estructura ──────────────────────────────────────────────────────────────────────────
  const programas = await supabase
    .from('programas_tarjeta')
    .select('id, comercio_id, nombre, slug, tipo_tarjeta, es_principal, activo, sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
    .limit(1);
  if (programas.error) {
    fallo('la tabla programas_tarjeta no existe o le faltan columnas', programas.error.message);
    process.exit(1);
  }
  ok('la tabla programas_tarjeta existe con las columnas esperadas.');

  const tarjetaCol = await supabase.from('tarjetas').select('programa_id').limit(1);
  if (tarjetaCol.error) {
    fallo('tarjetas no tiene la columna programa_id', tarjetaCol.error.message);
    process.exit(1);
  }
  ok('tarjetas tiene la columna programa_id.');

  // ── 2. Invariantes del backfill (re-verifican, DESPUÉS del hecho, lo que las guardas de la
  //      propia migración ya probaron adentro de la transacción — independiente de confiar en que
  //      esas guardas eran correctas) ────────────────────────────────────────────────────────────
  const { count: totalComercios, error: eCountComercios } = await supabase
    .from('comercios')
    .select('id', { count: 'exact', head: true });
  if (eCountComercios) fallo('no se pudo contar comercios', eCountComercios.message);

  const { count: totalPrincipales, error: eCountPrincipales } = await supabase
    .from('programas_tarjeta')
    .select('id', { count: 'exact', head: true })
    .eq('es_principal', true);
  if (eCountPrincipales) fallo('no se pudo contar programas principales', eCountPrincipales.message);

  if (!eCountComercios && !eCountPrincipales) {
    if (totalComercios === totalPrincipales) {
      ok(`cada comercio tiene exactamente un programa principal (${totalComercios}).`);
    } else {
      fallo(`descuadre: ${totalComercios} comercios pero ${totalPrincipales} programas principales`);
    }
  }

  const { count: huerfanas, error: eHuerfanas } = await supabase
    .from('tarjetas')
    .select('id', { count: 'exact', head: true })
    .is('programa_id', null);
  if (eHuerfanas) fallo('no se pudo contar tarjetas sin programa', eHuerfanas.message);
  else if ((huerfanas ?? 0) === 0) ok('ninguna tarjeta quedó sin programa_id.');
  else fallo(`${huerfanas} tarjetas quedaron con programa_id nulo`);

  // Cruce que NINGUNA guarda de la migración prueba: que el programa de cada tarjeta sea de SU
  // MISMO comercio. Nada en el esquema lo obliga (son dos FK independientes hacia comercios) — si
  // el backfill hubiera cruzado mal los ids, esto es lo único que lo detecta.
  const [{ data: todasTarjetas, error: eT }, { data: todosProgramas, error: eP }] = await Promise.all([
    supabase.from('tarjetas').select('id, comercio_id, programa_id'),
    supabase.from('programas_tarjeta').select('id, comercio_id'),
  ]);
  if (eT || eP) {
    fallo('no se pudo leer tarjetas/programas para el cruce de integridad', (eT ?? eP)?.message);
  } else {
    const comercioDePrograma = new Map((todosProgramas ?? []).map((p) => [p.id, p.comercio_id]));
    const cruzadas = (todasTarjetas ?? []).filter(
      (t) => t.programa_id && comercioDePrograma.get(t.programa_id) !== t.comercio_id,
    );
    if (cruzadas.length === 0) {
      ok(`las ${todasTarjetas?.length ?? 0} tarjetas apuntan a un programa de SU PROPIO comercio.`);
    } else {
      fallo(`${cruzadas.length} tarjetas apuntan al programa de OTRO comercio`, cruzadas.map((t) => t.id).join(', '));
    }
  }

  // Backfill correcto, no solo completo: el tipo/config del programa principal tiene que coincidir
  // con lo que tenía el comercio ANTES de la migración (que sigue ahí, sin tocar, adrede).
  const { data: unComercio } = await supabase
    .from('comercios')
    .select('id, tipo_tarjeta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
    .limit(1)
    .maybeSingle();
  if (unComercio) {
    const { data: suPrincipal, error: ePrincipal } = await supabase
      .from('programas_tarjeta')
      .select('tipo_tarjeta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
      .eq('comercio_id', unComercio.id)
      .eq('es_principal', true)
      .maybeSingle();
    if (ePrincipal || !suPrincipal) {
      fallo('no se encontró el programa principal de un comercio real', ePrincipal?.message);
    } else if (
      suPrincipal.tipo_tarjeta === unComercio.tipo_tarjeta &&
      Number(suPrincipal.cashback_porcentaje ?? 0) === Number(unComercio.cashback_porcentaje ?? 0) &&
      suPrincipal.multipass_visitas === unComercio.multipass_visitas &&
      suPrincipal.membresia_dias === unComercio.membresia_dias &&
      suPrincipal.cupon_vigencia_dias === unComercio.cupon_vigencia_dias
    ) {
      ok('el programa principal de un comercio real espeja su tipo y configuración.');
    } else {
      fallo('el programa principal NO coincide con el tipo/configuración del comercio', JSON.stringify({ unComercio, suPrincipal }));
    }
  } else {
    console.log('(sin comercios en la base — se omite el chequeo de espejado del backfill)');
  }

  // ── 3. Constraints, sobre datos propios que se crean y se borran ──────────────────────────────
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: com, error: eCom } = await supabase
    .from('comercios')
    .insert({ nombre: 'Verificacion 0024', slug: `verif-0024-${sufijo}` })
    .select('id')
    .single();
  if (eCom || !com) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }

  try {
    const { data: progA, error: ePA } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: com.id, nombre: 'Programa A', slug: 'programa-a', tipo_tarjeta: 'sellos', es_principal: true })
      .select('id')
      .single();
    const { data: progB, error: ePB } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: com.id, nombre: 'Programa B', slug: 'programa-b', tipo_tarjeta: 'cupon' })
      .select('id')
      .single();
    if (ePA || ePB || !progA || !progB) {
      fallo('no se pudieron crear los programas de prueba', (ePA ?? ePB)?.message);
      throw new Error('setup falló');
    }
    ok('se pueden crear varios programas activos en un mismo comercio.');

    const { data: cliente, error: eCliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente Verificacion', telefono: `+503-verif-0024-${sufijo}` })
      .select('id')
      .single();
    if (eCliente || !cliente) {
      fallo('no se pudo crear el cliente de prueba', eCliente?.message);
      throw new Error('setup falló');
    }

    const sinPrograma = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id } as never);
    if (sinPrograma.error?.code === '23502') {
      ok('rechaza crear una tarjeta SIN programa_id (23502, not-null).');
    } else {
      fallo('aceptó una tarjeta sin programa_id', sinPrograma.error?.message ?? 'sin error');
    }

    const tarjetaA = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id, programa_id: progA.id })
      .select('id')
      .single();
    if (tarjetaA.error) fallo('no se pudo crear la tarjeta del programa A', tarjetaA.error.message);

    // La razón de ser de la 0024: el mismo cliente puede tener OTRA tarjeta en el MISMO comercio si
    // es de un programa distinto. Con el unique viejo (cliente_id, comercio_id) esto habría fallado.
    const tarjetaB = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id, programa_id: progB.id })
      .select('id')
      .single();
    if (tarjetaB.error) {
      fallo('un cliente no pudo tener dos tarjetas del mismo comercio en programas distintos', tarjetaB.error.message);
    } else {
      ok('un cliente puede tener una tarjeta en CADA programa del mismo comercio.');
    }

    const repetida = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id, programa_id: progA.id });
    if (repetida.error?.code === '23505') {
      ok('rechaza una SEGUNDA tarjeta del mismo cliente en el MISMO programa (23505).');
    } else {
      fallo('aceptó dos tarjetas del mismo cliente en el mismo programa', repetida.error?.message ?? 'sin error');
    }

    // Como máximo un principal por comercio (índice único parcial).
    const segundoPrincipal = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: com.id, nombre: 'Otro principal', slug: 'otro-principal', tipo_tarjeta: 'puntos', es_principal: true });
    if (segundoPrincipal.error?.code === '23505') {
      ok('rechaza un SEGUNDO programa principal en el mismo comercio (23505).');
    } else {
      fallo('aceptó un segundo programa principal', segundoPrincipal.error?.message ?? 'sin error');
    }

    await supabase.from('tarjetas').delete().eq('comercio_id', com.id);
    await supabase.from('clientes').delete().eq('id', cliente.id);
    await supabase.from('programas_tarjeta').delete().eq('comercio_id', com.id);
  } catch (e) {
    if (!(e instanceof Error && e.message === 'setup falló')) throw e;
  } finally {
    await supabase.from('comercios').delete().eq('id', com.id);
    ok('datos de prueba borrados.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0024 está aplicada.');
  process.exit(0);
}

main();
