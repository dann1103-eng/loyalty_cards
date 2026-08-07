// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0031.ts
//
// Verificación de la migración 0031: renovar_membresia_atomico lee los días del PROGRAMA de la
// tarjeta y ya no de comercios.membresia_dias.
//
// La prueba que importa es la ASIMÉTRICA: se crea un comercio con `membresia_dias` NULO —como nace
// todo comercio desde la 0024— y el programa con los días cargados. Con la función vieja eso
// devolvía 'membresia_sin_configurar'; con la nueva renueva. Un comercio con el valor en las DOS
// tablas (que es lo que arma el fixture de tests) no distingue una versión de la otra.
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
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { data: com, error: eCom } = await supabase
    .from('comercios')
    // membresia_dias se deja NULO A PROPÓSITO: es el estado real de todo comercio post-0024 y el
    // único escenario donde la versión vieja y la nueva de la función se comportan distinto.
    .insert({ nombre: 'Verificacion 0031', slug: `verif-0031-${sufijo}`, tipo_tarjeta: 'membresia' })
    .select('id, membresia_dias')
    .single();
  if (eCom || !com) {
    fallo('no se pudo crear el comercio de prueba', eCom?.message);
    process.exit(1);
  }
  if (com.membresia_dias !== null) {
    fallo('el comercio de prueba nació con membresia_dias no nulo; la verificación no probaría nada');
  }

  try {
    const { data: prog, error: eProg } = await supabase
      .from('programas_tarjeta')
      .insert({
        comercio_id: com.id,
        nombre: 'Socios',
        slug: 'principal',
        tipo_tarjeta: 'membresia',
        es_principal: true,
        membresia_dias: 30,
      })
      .select('id')
      .single();
    if (eProg || !prog) {
      fallo('no se pudo crear el programa de prueba', eProg?.message);
      throw new Error('setup falló');
    }

    const { data: cliente, error: eCliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente Verificacion 0031', telefono: `+503${String(Date.now()).slice(-8)}0031` })
      .select('id')
      .single();
    if (eCliente || !cliente) {
      fallo('no se pudo crear el cliente de prueba', eCliente?.message);
      throw new Error('setup falló');
    }

    const { data: tarjeta, error: eTarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: com.id, programa_id: prog.id })
      .select('id')
      .single();
    if (eTarjeta || !tarjeta) {
      fallo('no se pudo crear la tarjeta de prueba', eTarjeta?.message);
      throw new Error('setup falló');
    }

    const { data, error } = await supabase.rpc('renovar_membresia_atomico', {
      p_comercio_id: com.id,
      p_tarjeta_id: tarjeta.id,
      p_sucursal_id: null,
      p_cajero_usuario_id: null,
    });
    const fila = data?.[0];
    if (error || !fila) {
      fallo('el RPC renovar_membresia_atomico falló', error?.message);
    } else if (fila.estado === 'membresia_sin_configurar') {
      fallo(
        'la función SIGUE leyendo comercios.membresia_dias — la migración 0031 NO está aplicada',
        'devolvió membresia_sin_configurar con el programa configurado en 30 días',
      );
    } else if (fila.estado !== 'ok') {
      fallo('estado inesperado del RPC', String(fila.estado));
    } else if (!fila.vence) {
      fallo('el RPC devolvió ok pero sin fecha de vencimiento');
    } else {
      ok(`renueva leyendo los días del PROGRAMA (vence ${fila.vence}).`);
    }

    // La otra mitad: sin días en el programa TAMPOCO puede renovar. Si esto también diera 'ok', la
    // comprobación de arriba estaría pasando por cualquier motivo.
    await supabase.from('programas_tarjeta').update({ membresia_dias: null }).eq('id', prog.id);
    const sinConfig = await supabase.rpc('renovar_membresia_atomico', {
      p_comercio_id: com.id,
      p_tarjeta_id: tarjeta.id,
      p_sucursal_id: null,
      p_cajero_usuario_id: null,
    });
    if (sinConfig.data?.[0]?.estado === 'membresia_sin_configurar') {
      ok('sin días en el programa, responde membresia_sin_configurar.');
    } else {
      fallo(
        'renovó sin tener los días configurados en el programa',
        String(sinConfig.data?.[0]?.estado ?? sinConfig.error?.message),
      );
    }

    await supabase.from('transacciones_puntos').delete().eq('tarjeta_id', tarjeta.id);
    await supabase.from('tarjetas').delete().eq('id', tarjeta.id);
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
  console.log('\nTodo en orden: la migración 0031 está aplicada.');
  process.exit(0);
}

main();
