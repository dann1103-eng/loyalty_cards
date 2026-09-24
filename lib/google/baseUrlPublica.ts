// ¿Puede Google descargar una imagen cuya URL se arma sobre esta base?
//
// Los objetos y las clases de Google llevan imágenes con URL ABSOLUTA armada a partir de
// NEXT_PUBLIC_BASE_URL (lib/google/heroUrl.ts, lib/google/logosClase.ts). Los servidores de Google las
// bajan desde internet: con `http://` o con un host local, la API RECHAZA EL PATCH ENTERO con
// `400 Image cannot be loaded` — no falla solo la imagen, no se guarda nada. Un script que recorre
// producción desde una máquina de desarrollo (donde .env.local apunta a localhost) tiene que frenar
// ANTES de la primera llamada.
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

// La base (sin barra final) sobre la que se arman las URLs de las imágenes COMPUESTAS que Google
// descarga —la portada y el hero (heroUrl.ts), los logos de la clase (logosClase.ts)—, o null si no es
// pública. Con null cada llamador degrada: la foto o el logo crudos del bucket (que sí son públicos), o
// nada.
//
// El chequeo es `esBaseUrlPublica` y NO "que la variable exista": en desarrollo NEXT_PUBLIC_BASE_URL es
// `http://localhost:3000`, y con un chequeo de presencia cada sync de clase desde el dev server armaba
// la portada sobre localhost y Google rechazaba el patch ENTERO — ni siquiera con el logo crudo se
// sincronizaba la clase de un comercio con portada (todos los demos la tienen). En producción no cambia
// nada: la base es `https://www.cardly-sv.site`.
export function baseParaImagenesGoogle(): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base || !esBaseUrlPublica(base)) return null;
  return base.replace(/\/$/, '');
}
