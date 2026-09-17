// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0036.ts
// Lee la columna y prueba el CHECK con un cliente DE PRUEBA que crea y borra al terminar: nunca
// escribe sobre un cliente real.
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

  // 1. La columna existe.
  const lectura = await supabase.from('clientes').select('id, apellido').limit(1);
  if (lectura.error) {
    fallo('a clientes le falta la columna apellido (¿no se aplicó la 0036?)', lectura.error.message);
    process.exit(1);
  }
  ok('clientes tiene la columna apellido.');

  // 2. Un cliente de prueba: sin apellido (los que ya existen), con apellido, y los dos rechazos del
  // CHECK. El teléfono es imposible para un cliente real (prefijo +000) y se borra al final.
  const telefono = `+000${Date.now()}`;
  const { data: cliente, error: errorAlta } = await supabase
    .from('clientes')
    .insert({ nombre: 'Verificación 0036', telefono })
    .select('id, apellido')
    .single();
  if (errorAlta || !cliente) {
    fallo('no se pudo crear el cliente de prueba sin apellido', errorAlta?.message);
    process.exit(1);
  }
  try {
    if (cliente.apellido === null) ok('un cliente sin apellido se sigue pudiendo crear (queda en null).');
    else fallo('el apellido nace con un valor', String(cliente.apellido));

    const conApellido = await supabase.from('clientes').update({ apellido: 'Rivera' }).eq('id', cliente.id);
    if (conApellido.error) fallo('rechazó un apellido válido', conApellido.error.message);
    else ok('acepta un apellido válido.');

    const blanco = await supabase.from('clientes').update({ apellido: '   ' }).eq('id', cliente.id);
    if (blanco.error?.code === '23514') ok('el CHECK rechaza un apellido en blanco.');
    else fallo('el CHECK no rechaza un apellido en blanco', blanco.error?.message ?? 'lo aceptó');

    const largo = await supabase.from('clientes').update({ apellido: 'x'.repeat(121) }).eq('id', cliente.id);
    if (largo.error?.code === '23514') ok('el CHECK rechaza 121 caracteres.');
    else fallo('el CHECK no rechaza 121 caracteres', largo.error?.message ?? 'lo aceptó');
  } finally {
    await supabase.from('clientes').delete().eq('id', cliente.id);
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nMigración 0036 verificada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
