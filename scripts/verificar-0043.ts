// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0043.ts
// Verificación de SOLO LECTURA de la migración 0043 (sellos de regalo al registrarse): la columna
// programas_tarjeta.sellos_regalo existe con ningún programa tocado, y la función emitir_tarjeta
// existe y corre.
//
// Qué NO verifica, a propósito: el CHECK cruzado con la meta y el tipo 'regalo' del ledger. Probarlos
// exigiría escribir (un programa con regalo mayor que la meta, un movimiento de regalo) y este script
// no escribe nada. Los prueban las pruebas de integración de lib/tarjetas/ y lib/clientes/.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { randomUUID } from 'node:crypto';
import { createServiceClient } from '../lib/supabase/server';

async function main() {
  const supabase = createServiceClient();
  let fallas = 0;
  const fallo = (m: string) => {
    console.error(`FALLO: ${m}`);
    fallas += 1;
  };

  // (a) La columna existe. 42703 = "undefined_column": la migración no se aplicó.
  const columna = await supabase.from('programas_tarjeta').select('id, sellos_regalo').limit(1);
  if (columna.error) {
    fallo(
      columna.error.code === '42703'
        ? `la 0043 NO está aplicada en programas_tarjeta — ${columna.error.message}`
        : `no se pudo leer programas_tarjeta — ${columna.error.message}`,
    );
  } else {
    console.log('OK: programas_tarjeta tiene sellos_regalo.');

    const cabeza = { count: 'exact', head: true } as const;
    const [programas, conRegalo] = await Promise.all([
      supabase.from('programas_tarjeta').select('id', cabeza),
      supabase.from('programas_tarjeta').select('id', cabeza).neq('sellos_regalo', 0),
    ]);
    if (programas.error || conRegalo.error) {
      fallo('no se pudo contar los programas — ' + (programas.error ?? conRegalo.error)?.message);
    } else {
      console.log(`    programas: ${programas.count} — con sellos de regalo (distinto de 0): ${conRegalo.count}`);
      // Recién aplicada la migración tiene que dar 0: la columna nace en 0 y ningún programa cambia.
      // No es un FALLO si da más: corrida después de que algún dueño configuró su regalo, es lo
      // esperado, y marcar rojo un uso legítimo enseñaría a ignorar este script.
      if ((conRegalo.count ?? 0) > 0) {
        console.log('    AVISO: recién aplicada la 0043 este número tiene que ser 0. Si ya hay dueños que');
        console.log('    configuraron su regalo es normal; si no, alguien tocó la columna.');
      }
    }
  }

  // (b) La función existe y corre. Con uuids que no existen en ninguna tabla, el insert de la tarjeta
  // lo frena la clave foránea (23503) sin escribir nada. Los otros desenlaces dicen cosas distintas:
  //   PGRST202  la función no existe (la migración no se aplicó, o el caché de PostgREST no la vio).
  //   sin error la función CREÓ una tarjeta con uuids inventados: no debería ser posible. Si pasa,
  //             hay una fila suelta en `tarjetas` para limpiar a mano.
  const respuesta = await supabase.rpc('emitir_tarjeta', {
    p_comercio_id: randomUUID(),
    p_programa_id: randomUUID(),
    p_cliente_id: randomUUID(),
    p_vigencia_hasta: null,
  });
  if (respuesta.error?.code === '23503') {
    console.log('OK: emitir_tarjeta existe y corrió (la clave foránea frenó el insert, sin escribir nada).');
  } else if (respuesta.error?.code === 'PGRST202') {
    fallo(`la 0043 NO está aplicada: emitir_tarjeta no existe — ${respuesta.error.message}`);
  } else if (respuesta.error) {
    fallo(`emitir_tarjeta falló con un código inesperado (${respuesta.error.code}) — ${respuesta.error.message}`);
  } else {
    fallo(
      'emitir_tarjeta devolvió una tarjeta con uuids inventados — revisá la tabla tarjetas por una fila suelta: ' +
        JSON.stringify(respuesta.data),
    );
  }

  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error('FALLO GENERAL:', e);
  process.exit(1);
});
