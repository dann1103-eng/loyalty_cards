// Extracción de coordenadas de lo que el dueño pega en el formulario de sucursal.
//
// Ningún dueño sabe su latitud de memoria, así que la entrada real es "abro Google Maps, busco mi
// local, copio y pego". El problema es que Google devuelve media docena de formatos distintos según
// desde dónde se copie, y el MÁS COMÚN —el botón Compartir del teléfono— es un acortador que NO
// contiene las coordenadas: hay que expandirlo con una petición HTTP.
//
// La parte de parseo es PURA y está separada de la de red a propósito: los formatos son lo que más
// se rompe cuando Google cambia sus URLs, y así se prueban sin tocar la red.

export interface Coordenadas {
  latitud: number;
  longitud: number;
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

// El orden importa y no es arbitrario:
//
// 1. `!3d…!4d…` son las coordenadas del LUGAR dentro del blob `data=` de una URL de place. Es el
//    dato que queremos: la puerta del negocio.
// 2. `@lat,lng` es el CENTRO DEL MAPA, que suele estar cerca pero no es lo mismo — si el dueño
//    movió el mapa antes de copiar, apunta a otro lado. Sirve de respaldo.
// 3. Los parámetros de consulta (q, query, ll, …) aparecen en links armados a mano y en los de
//    "cómo llegar".
const PATRONES: RegExp[] = [
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  new RegExp(String.raw`@${NUM},${NUM}`),
  new RegExp(String.raw`[?&](?:q|query|ll|sll|daddr|destination)=${NUM},\s*${NUM}`),
];

// "13.698900, -89.191400" tal cual, que es lo que sale de mantener presionado un punto en el mapa
// y tocar las coordenadas para copiarlas. Es la ruta de escape cuando ningún link funciona.
const CRUDO = new RegExp(String.raw`^\s*${NUM}\s*,\s*${NUM}\s*$`);

function armar(lat: string, lng: string): Coordenadas | null {
  const latitud = Number(lat);
  const longitud = Number(lng);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) return null;
  if (latitud < -90 || latitud > 90) return null;
  if (longitud < -180 || longitud > 180) return null;
  // (0,0) es el "null island" del Atlántico: en la práctica siempre significa que algo se parseó
  // mal, nunca que el local esté ahí. Rechazarlo evita mandar a los clientes a alta mar.
  if (latitud === 0 && longitud === 0) return null;
  return { latitud, longitud };
}

export function parsearCoordenadas(entrada: string): Coordenadas | null {
  const texto = entrada.trim();
  if (!texto) return null;

  const crudo = CRUDO.exec(texto);
  if (crudo) return armar(crudo[1], crudo[2]);

  for (const patron of PATRONES) {
    const encontrado = patron.exec(texto);
    if (encontrado) {
      const coords = armar(encontrado[1], encontrado[2]);
      if (coords) return coords;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Expansión de enlaces cortos
// ─────────────────────────────────────────────────────────────────────────────

function esHostDeGoogle(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'goo.gl' || host === 'maps.app.goo.gl') return true;
  // google.com, www.google.com, maps.google.com, google.com.sv, google.es…
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2,3})?$/.test(host);
}

export function esEnlaceCortoDeMapas(entrada: string): boolean {
  try {
    const url = new URL(entrada.trim());
    const host = url.hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl';
  } catch {
    return false;
  }
}

// Sigue las redirecciones A MANO en vez de dejar que fetch lo haga solo, y valida CADA salto contra
// la lista de hosts de Google.
//
// Esto no es prolijidad: acá se hace una petición desde nuestro servidor a una URL que escribió el
// usuario, que es la receta de un SSRF. Sin validar cada salto, un acortador podría redirigir a
// 169.254.169.254 (metadatos de la nube) o a un servicio interno, y nuestro servidor lo consultaría
// con su propia identidad de red. Con `redirect: 'manual'` vemos cada destino ANTES de ir.
export async function expandirEnlaceCorto(entrada: string): Promise<string | null> {
  let actual: string;
  try {
    const url = new URL(entrada.trim());
    if (url.protocol !== 'https:' || !esHostDeGoogle(url.hostname)) return null;
    actual = url.toString();
  } catch {
    return null;
  }

  // Google suele encadenar dos o tres saltos (acortador → consent → maps). Cinco da margen sin
  // permitir una cadena infinita.
  for (let salto = 0; salto < 5; salto += 1) {
    let respuesta: Response;
    try {
      respuesta = await fetch(actual, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          // Sin User-Agent de navegador, Google a veces responde una página distinta sin la URL
          // larga. No es evasión de nada: es pedir la misma versión que vería el dueño.
          'User-Agent': 'Mozilla/5.0 (compatible; CardlySV/1.0)',
        },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      return null;
    }

    const destino = respuesta.headers.get('location');
    if (!destino) {
      // Sin redirección: o ya es la URL final, o Google devolvió el HTML. En los dos casos el
      // caller intenta parsear lo que tenemos.
      return actual;
    }

    let siguiente: URL;
    try {
      siguiente = new URL(destino, actual);
    } catch {
      return null;
    }
    if (siguiente.protocol !== 'https:' || !esHostDeGoogle(siguiente.hostname)) return null;
    actual = siguiente.toString();
  }

  return actual;
}

// Resuelve lo que sea que haya pegado el dueño: coordenadas sueltas, una URL larga, o un enlace
// corto que hay que expandir primero. Es la función que llama el Server Action.
export async function resolverCoordenadas(entrada: string): Promise<Coordenadas | null> {
  const directo = parsearCoordenadas(entrada);
  if (directo) return directo;

  if (!esEnlaceCortoDeMapas(entrada)) return null;

  const expandido = await expandirEnlaceCorto(entrada);
  return expandido ? parsearCoordenadas(expandido) : null;
}
