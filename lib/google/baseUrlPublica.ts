// ¿Puede Google descargar una imagen cuya URL se arma sobre esta base?
//
// Los objetos y las clases de Google llevan imágenes con URL ABSOLUTA armada a partir de
// NEXT_PUBLIC_BASE_URL (lib/google/heroUrl.ts). Los servidores de Google las bajan desde internet: con
// `http://` o con un host local, la API RECHAZA EL PATCH ENTERO con `400 Image cannot be loaded` —
// no falla solo la imagen, no se guarda nada. Un script que recorre producción desde una máquina de
// desarrollo (donde .env.local apunta a localhost) tiene que frenar ANTES de la primera llamada.
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1']);

export function esBaseUrlPublica(url: string | undefined): boolean {
  // `startsWith` sobre el texto CRUDO y no sobre `new URL(url).protocol`: heroUrl.ts concatena el
  // valor tal cual, y `URL` perdona espacios delante y mayúsculas que la URL armada no perdona.
  if (!url || !url.startsWith('https://')) return false;
  try {
    // `hostname` ya viene normalizado (minúsculas, sin puerto): `https://LOCALHOST:3000` no se cuela.
    return !HOSTS_LOCALES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
