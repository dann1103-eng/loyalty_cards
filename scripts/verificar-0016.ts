// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0016.ts
// Verificación de la migración 0016 (geopush por sucursal). SOLO LECTURA salvo por una escritura
// que se revierte: la única forma honesta de comprobar que un CHECK está activo es intentar
// violarlo. Se hace sobre una sucursal de prueba propia, que se borra al final.
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

  const columnas = await supabase
    .from('sucursales')
    .select('latitud, longitud, mensaje_cercania, geopush_activo')
    .limit(1);
  if (columnas.error) {
    fallo('sucursales no tiene las columnas del geopush', columnas.error.message);
    console.error('¿Se corrió la migración 0016? PostgREST también tarda unos segundos en verla.');
    process.exit(1);
  }
  ok('sucursales tiene latitud, longitud, mensaje_cercania y geopush_activo.');

  const activas = await supabase
    .from('sucursales')
    .select('nombre, geopush_activo')
    .eq('geopush_activo', true);
  if (!activas.error) {
    if (activas.data.length === 0) {
      ok('ninguna sucursal tiene el aviso por cercanía activo (nada cambió para nadie).');
    } else {
      console.log(`AVISO: ${activas.data.length} sucursal(es) ya con aviso activo.`);
    }
  }

  // Un comercio + sucursal descartables para probar los CHECK sin tocar datos reales.
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio, error: eCom } = await supabase
    .from('comercios')
    .insert({ nombre: 'Verificacion 0016', slug: `verif-0016-${sufijo}` })
    .select('id')
    .single();
  if (eCom || !comercio) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }

  try {
    const { data: sucursal, error: eSuc } = await supabase
      .from('sucursales')
      .insert({ comercio_id: comercio.id, nombre: 'Prueba 0016' })
      .select('id')
      .single();
    if (eSuc || !sucursal) {
      fallo('no se pudo crear la sucursal de prueba', eSuc?.message);
      return;
    }

    // El candado que importa: geopush activo SIN coordenadas generaría un `locations` inválido
    // dentro del .pkpass, y un pase mal formado no lo rechaza el servidor — lo rechaza el teléfono
    // del cliente, donde ya no se puede diagnosticar.
    const sinCoords = await supabase
      .from('sucursales')
      .update({ geopush_activo: true })
      .eq('id', sucursal.id);
    if (sinCoords.error?.code === '23514') {
      ok('la BD rechaza activar el aviso sin coordenadas (23514).');
    } else {
      fallo('se pudo activar el aviso SIN coordenadas', sinCoords.error?.message ?? 'sin error');
    }

    const fueraDelPlaneta = await supabase
      .from('sucursales')
      .update({ latitud: 91, longitud: 0 })
      .eq('id', sucursal.id);
    if (fueraDelPlaneta.error?.code === '23514') {
      ok('la BD rechaza una latitud fuera de rango (23514).');
    } else {
      fallo('se aceptó una latitud de 91 grados', fueraDelPlaneta.error?.message ?? 'sin error');
    }

    // 128 es el límite de relevantText en PassKit. Apple no rechaza un texto más largo: lo CORTA en
    // silencio, así que el candado tiene que estar de este lado.
    const mensajeLargo = await supabase
      .from('sucursales')
      .update({ mensaje_cercania: 'x'.repeat(129) })
      .eq('id', sucursal.id);
    if (mensajeLargo.error?.code === '23514') {
      ok('la BD rechaza un mensaje de más de 128 caracteres (23514).');
    } else {
      fallo('se aceptó un mensaje de 129 caracteres', mensajeLargo.error?.message ?? 'sin error');
    }

    const valido = await supabase
      .from('sucursales')
      .update({ latitud: 13.6989, longitud: -89.1914, mensaje_cercania: 'Pasá por tu café', geopush_activo: true })
      .eq('id', sucursal.id);
    if (valido.error) {
      fallo('rechazó una configuración VÁLIDA', valido.error.message);
    } else {
      ok('acepta coordenadas, mensaje y aviso activo cuando todo es válido.');
    }

    await supabase.from('sucursales').delete().eq('id', sucursal.id);
  } finally {
    await supabase.from('comercios').delete().eq('id', comercio.id);
    ok('datos de prueba borrados.');
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0016 está aplicada.');
  process.exit(0);
}

main();
