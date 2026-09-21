// Ejecutar vía: npx tsx --conditions=react-server scripts/probar-wompi.ts
//
// PUNTO 0 de la spec de la pasarela (docs/superpowers/specs/2026-09-21-pasarela-wompi-design.md, "A
// verificar"): ¿alcanzan el App ID y el API Secret del negocio para crear un enlace de pago? La página
// de la doc de "Crear Enlace de Pago" no dice con qué credenciales se autentica, y todo el diseño
// depende de eso. Este script lo prueba con UNA llamada real, en modo prueba.
//
// Qué hace, en orden:
//   1. Pide un token con WOMPI_CLIENT_ID / WOMPI_CLIENT_SECRET (de .env.local).
//   2. Lee los datos del negocio y SE NIEGA A SEGUIR si el negocio ya es productivo (un enlace creado
//      acá en producción sería un cobro real).
//   3. Consulta una transacción que no existe: confirma cómo responde GET /TransaccionCompra/{id} con
//      estas credenciales (se espera 404).
//   4. Crea UN enlace de prueba de $1.00 que vence en 1 hora, con el webhook de la app.
//
// Lo que imprime NO incluye credenciales ni tokens. Se puede copiar y pegar tal cual.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { leerConfigWompi } from '../lib/wompi/config';
import { crearClienteWompi, ErrorWompi } from '../lib/wompi/cliente';

const linea = (m: string) => console.log(m);

async function main() {
  let cliente;
  try {
    cliente = crearClienteWompi(leerConfigWompi());
  } catch (e) {
    console.error(`FALLO: ${e instanceof Error ? e.message : String(e)}`);
    console.error('Poné WOMPI_CLIENT_ID y WOMPI_CLIENT_SECRET en .env.local (el App ID y el API Secret del panel de Wompi).');
    process.exit(1);
  }

  // 1 y 2. El token y los datos del negocio.
  let negocio;
  try {
    negocio = await cliente.datosDelNegocio();
  } catch (e) {
    console.error(`FALLO al autenticar o leer el negocio: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
  linea('OK: Wompi aceptó las credenciales del negocio (OAuth client_credentials).');
  linea(`    negocio: ${negocio.nombre ?? '(sin nombre)'} · productivo: ${negocio.esProductivo}`);

  if (negocio.esProductivo) {
    console.error('\nNo sigo: el negocio de Wompi está en PRODUCCIÓN y crear un enlace acá sería un cobro real.');
    console.error('Volvelo a modo desarrollo en el panel de Wompi para probar.');
    process.exit(1);
  }

  // 3. Una transacción que no existe.
  try {
    await cliente.consultarTransaccion('00000000-0000-0000-0000-000000000000');
    linea('AVISO: GET /TransaccionCompra devolvió algo para un id inexistente (raro).');
  } catch (e) {
    if (e instanceof ErrorWompi && e.estado === 404) {
      linea('OK: GET /TransaccionCompra/{id} con estas credenciales responde 404 para un id inexistente (lo esperado).');
    } else {
      linea(`AVISO: GET /TransaccionCompra/{id} respondió distinto de 404: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4. Un enlace de prueba.
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.cardly-sv.site').replace(/\/+$/, '');
  const ahora = new Date();
  try {
    const enlace = await cliente.crearEnlacePago({
      identificador: `prueba-conexion-${ahora.getTime()}`,
      monto: 1,
      nombreProducto: 'Cardly SV · Prueba de conexión',
      descripcion: 'Enlace de prueba creado por scripts/probar-wompi.ts. No es un cobro real.',
      urlRedirect: `${base}/comercio/plan/pago/resultado`,
      urlRetorno: `${base}/comercio/plan`,
      urlWebhook: `${base}/api/wompi/webhook`,
      ahora,
      venceEn: new Date(ahora.getTime() + 60 * 60 * 1000),
      datosAdicionales: { origen: 'probar-wompi' },
    });
    linea('OK: POST /EnlacePago con las credenciales del negocio creó un enlace.');
    linea(`    idEnlace: ${enlace.idEnlace}`);
    linea(`    urlEnlace: ${enlace.urlEnlace}`);
    linea(`    productivo: ${enlace.esProductivo}   (se espera false)`);
    linea('\nAbrí la urlEnlace, pagá con una tarjeta de prueba y mirá qué hace el redirect y el webhook.');
    linea('Punto 0 de la spec: RESUELTO (las credenciales del negocio alcanzan para crear enlaces).');
  } catch (e) {
    console.error(`FALLO al crear el enlace: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof ErrorWompi && (e.estado === 401 || e.estado === 403)) {
      console.error('\nPunto 0 de la spec: las credenciales del NEGOCIO no alcanzan para crear enlaces.');
      console.error('Habría que rediseñar (la doc pide usuario y contraseña de la cuenta para otros endpoints).');
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
