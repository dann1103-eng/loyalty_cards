import sharp from 'sharp';
import type { Medidas } from '../comercio/encuadreFranja';

// El logo ORIGINAL de un comercio o programa, tal como está en el bucket: sus bytes (las rutas
// logo.png y logo-ancho.png lo componen) y sus medidas (los syncs de la clase deciden con ellas si
// mandan el logo ancho, ver logosClase.ts).
//
// Vive en su propio módulo, y no dentro de logosClase.ts, para que las pruebas de los syncs puedan
// mockear la medición sin tocar el `fetch` global, que es el mismo que usa el cliente de Supabase con
// el que esas pruebas arman sus datos. Ninguna prueba de sync baja un logo de verdad.

// Descarga el logo con un tiempo máximo. null (nunca lanza) si no responde a tiempo, si responde con
// error o si la red falla: cada llamador decide qué hacer sin logo.
export async function bajarLogo(
  url: string,
  tiempoMaximoMs: number,
): Promise<{ bytes: Buffer; tipo: string | null } | null> {
  try {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(tiempoMaximoMs) });
    if (!respuesta.ok) {
      console.warn(`[google] el logo ${url} respondió ${respuesta.status}`);
      return null;
    }
    return { bytes: Buffer.from(await respuesta.arrayBuffer()), tipo: respuesta.headers.get('content-type') };
  } catch (error) {
    console.warn(`[google] no se pudo bajar el logo ${url}:`, error);
    return null;
  }
}

// Corto a propósito: la clase se sincroniza en caminos CALIENTES — syncClaseComercio corre en cada
// registro de cliente y generarLinkGuardar en cada toque de "Agregar a Google Wallet" —, y el cliente
// está mirando la pantalla mientras tanto. Si el bucket tarda más que esto, la clase sale sin decidir
// el logo ancho (se omite la clave, ver logosDeClase): mejor eso que una pantalla colgada.
export const TIEMPO_MAXIMO_MEDICION_MS = 2000;

// Caché en memoria, por instancia del servidor, de las mediciones EXITOSAS. Es segura sin
// invalidación porque la URL del logo ya trae su propio `?v=<timestamp>` del bucket
// (imagenComercio.ts): re-subir el logo cambia la URL, así que una URL dada siempre mide lo mismo.
// Crece con la cantidad de logos distintos que ve la instancia, que es chica, y se pierde con ella.
const medicionesPorUrl = new Map<string, Medidas>();

// Ancho y alto en píxeles del logo, o null si no se pudo medir.
//
// Los fallos NO se cachean: un null por timeout (un arranque en frío justo después de subir el logo,
// por ejemplo) dejaría el logo ancho apagado hasta que la instancia reinicie. Así, el próximo sync
// vuelve a intentar.
export async function medidasLogo(url: string): Promise<Medidas | null> {
  const enCache = medicionesPorUrl.get(url);
  if (enCache) return enCache;

  const logo = await bajarLogo(url, TIEMPO_MAXIMO_MEDICION_MS);
  if (!logo) return null;
  try {
    const { width, height } = await sharp(logo.bytes).metadata();
    if (!width || !height) return null;
    const medidas = { ancho: width, alto: height };
    medicionesPorUrl.set(url, medidas);
    return medidas;
  } catch (error) {
    console.warn(`[google] no se pudieron medir las dimensiones del logo ${url}:`, error);
    return null;
  }
}
