import 'server-only';

// Configuración de Wompi (pasarela de pagos de El Salvador). Todo sale del entorno del servidor: las
// credenciales NUNCA llevan el prefijo NEXT_PUBLIC_ ni llegan al navegador.
//
// WOMPI_CLIENT_ID     = el "App ID" del negocio en el panel de Wompi.
// WOMPI_CLIENT_SECRET = el "API Secret" del mismo negocio. Además de autenticar contra la API, es la
//                       llave con la que Wompi firma sus webhooks.
// Nunca se guarda ni se usa el usuario y la contraseña de la CUENTA Wompi: los endpoints que los piden
// (editar, activar o desactivar enlaces) no se llaman desde la app.

export interface ConfigWompi {
  clientId: string;
  clientSecret: string;
  urlApi: string;
  urlId: string;
  // ¿Un pago de PRUEBA puede activar un plan? Ver `pruebasAceptadas`.
  aceptarPruebas: boolean;
}

export type Entorno = Record<string, string | undefined>;

const URL_API_POR_DEFECTO = 'https://api.wompi.sv';
const URL_ID_POR_DEFECTO = 'https://id.wompi.sv';

// Las pruebas se aceptan SOLO si se pide con WOMPI_ACEPTAR_PRUEBAS=1 Y el entorno de Vercel está
// ausente (desarrollo local) o es `development`.
//
// Es una lista de PERMITIDOS y no de denegados a propósito. La versión inversa (`!== 'production'`)
// aceptaría pruebas en un despliegue Preview, y un Preview comparte la base de datos REAL: un pago de
// prueba, que no mueve plata, activaría un plan de verdad. Con esta forma, un valor inesperado de
// VERCEL_ENV rechaza las pruebas en vez de aceptarlas.
export function pruebasAceptadas(entorno: Entorno): boolean {
  if (entorno.WOMPI_ACEPTAR_PRUEBAS !== '1') return false;
  const vercel = entorno.VERCEL_ENV;
  return vercel === undefined || vercel === '' || vercel === 'development';
}

function sinBarraFinal(url: string | undefined, porDefecto: string): string {
  const limpia = url?.trim();
  return limpia ? limpia.replace(/\/+$/, '') : porDefecto;
}

export function leerConfigWompi(entorno: Entorno = process.env): ConfigWompi {
  const clientId = entorno.WOMPI_CLIENT_ID?.trim();
  const clientSecret = entorno.WOMPI_CLIENT_SECRET?.trim();
  if (!clientId) throw new Error('Falta la variable de entorno WOMPI_CLIENT_ID');
  if (!clientSecret) throw new Error('Falta la variable de entorno WOMPI_CLIENT_SECRET');
  return {
    clientId,
    clientSecret,
    urlApi: sinBarraFinal(entorno.WOMPI_API_URL, URL_API_POR_DEFECTO),
    urlId: sinBarraFinal(entorno.WOMPI_ID_URL, URL_ID_POR_DEFECTO),
    aceptarPruebas: pruebasAceptadas(entorno),
  };
}
