// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0026.ts
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

  const difusiones = await supabase.from('difusiones').select('id').limit(1);
  if (difusiones.error) {
    fallo('la tabla difusiones no existe o le faltan columnas', difusiones.error.message);
    process.exit(1);
  }
  ok('la tabla difusiones existe.');

  const notif = await supabase.from('notificaciones_enviadas').select('id').limit(1);
  if (notif.error) {
    fallo('la tabla notificaciones_enviadas no existe o le faltan columnas', notif.error.message);
    process.exit(1);
  }
  ok('la tabla notificaciones_enviadas existe.');

  const tarjetaCols = await supabase
    .from('tarjetas')
    .select('aviso_texto, aviso_hasta, aviso_inactividad_enviado_en')
    .limit(1);
  if (tarjetaCols.error) {
    fallo('tarjetas no tiene las columnas de aviso', tarjetaCols.error.message);
    process.exit(1);
  }
  ok('tarjetas tiene aviso_texto, aviso_hasta y aviso_inactividad_enviado_en.');

  const comercioCols = await supabase
    .from('comercios')
    .select('aviso_inactividad_activo, aviso_inactividad_dias, aviso_inactividad_mensaje')
    .limit(1);
  if (comercioCols.error) {
    fallo('comercios no tiene las columnas de la perilla de inactividad', comercioCols.error.message);
    process.exit(1);
  }
  ok('comercios tiene las tres columnas de la perilla de inactividad.');

  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: com, error: eCom } = await supabase
    .from('comercios')
    .insert({ nombre: 'Verificacion 0026', slug: `verif-0026-${sufijo}` })
    .select('id')
    .single();
  if (eCom || !com) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }

  try {
    const { data: programa, error: eProg } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: com.id, nombre: 'Principal', slug: 'principal', tipo_tarjeta: 'puntos', es_principal: true })
      .select('id')
      .single();
    if (eProg || !programa) {
      fallo('no se pudo crear el programa de prueba', eProg?.message);
      throw new Error('setup falló');
    }

    const { data: usuario, error: eUsuario } = await supabase
      .from('usuarios_comercio')
      .insert({ comercio_id: com.id, email: `verif-0026-${sufijo}@ejemplo.test`, rol: 'owner' })
      .select('id')
      .single();
    if (eUsuario || !usuario) {
      fallo('no se pudo crear el usuario de prueba', eUsuario?.message);
      throw new Error('setup falló');
    }

    const mensajeVacio = await supabase
      .from('difusiones')
      .insert({ comercio_id: com.id, mensaje: '   ', vigente_hasta: '2026-12-31', creada_por: usuario.id });
    if (mensajeVacio.error?.code === '23514') {
      ok('rechaza un mensaje de difusión vacío (23514).');
    } else {
      fallo('aceptó un mensaje de difusión vacío', mensajeVacio.error?.message ?? 'sin error');
    }

    const { data: difusion, error: eDifusion } = await supabase
      .from('difusiones')
      .insert({ comercio_id: com.id, mensaje: 'Promo de verificación', vigente_hasta: '2026-12-31', creada_por: usuario.id })
      .select('id')
      .single();
    if (eDifusion || !difusion) {
      fallo('no se pudo crear una difusión válida', eDifusion?.message);
      throw new Error('setup falló');
    }
    ok('acepta una difusión válida.');

    const { data: cliente, error: eCliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente Verificacion', telefono: `+503-verif-0026-${sufijo}` })
      .select('id')
      .single();
    if (eCliente || !cliente) {
      fallo('no se pudo crear el cliente de prueba', eCliente?.message);
      throw new Error('setup falló');
    }
    const { data: tarjeta, error: eTarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id, programa_id: programa.id })
      .select('id')
      .single();
    if (eTarjeta || !tarjeta) {
      fallo('no se pudo crear la tarjeta de prueba', eTarjeta?.message);
      throw new Error('setup falló');
    }

    const canalInvalido = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tarjeta.id, canal: 'sms', origen: 'campana' });
    if (canalInvalido.error?.code === '23514') {
      ok('rechaza un canal fuera de la lista (23514).');
    } else {
      fallo('aceptó un canal inválido', canalInvalido.error?.message ?? 'sin error');
    }

    const origenInvalido = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tarjeta.id, canal: 'google', origen: 'marketing' });
    if (origenInvalido.error?.code === '23514') {
      ok('rechaza un origen fuera de la lista (23514).');
    } else {
      fallo('aceptó un origen inválido', origenInvalido.error?.message ?? 'sin error');
    }

    const { error: eNotif } = await supabase
      .from('notificaciones_enviadas')
      .insert({ tarjeta_id: tarjeta.id, canal: 'google', origen: 'campana', difusion_id: difusion.id });
    if (eNotif) fallo('no se pudo insertar una notificación válida', eNotif.message);
    else ok('acepta una notificación válida con difusion_id.');

    await supabase.from('notificaciones_enviadas').delete().eq('tarjeta_id', tarjeta.id);
    await supabase.from('tarjetas').delete().eq('id', tarjeta.id);
    await supabase.from('clientes').delete().eq('id', cliente.id);
    await supabase.from('difusiones').delete().eq('comercio_id', com.id);
    await supabase.from('usuarios_comercio').delete().eq('id', usuario.id);
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
  console.log('\nTodo en orden: la migración 0026 está aplicada.');
  process.exit(0);
}

main();
