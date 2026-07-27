import { ipAddress } from '@vercel/functions';

// Extrae la IP del cliente. La fuente confiable en Vercel es el helper del paquete oficial
// (@vercel/functions), que resuelve la cadena de proxies correctamente.
//
// Firma CONFIRMADA contra el paquete instalado (headers.d.ts:95):
//   export declare function ipAddress(input: Request | Headers): string | undefined;
//
// Acepta `Request` (Route Handlers, como /api/portal/consulta) o `Headers` sueltas: un Server
// Action NO recibe una Request, solo puede pedir `await headers()`. Sin esta segunda forma habría
// que fabricar una Request de mentira solo para volver a sacarle las cabeceras.
export function obtenerIp(fuente: Request | Headers): string {
  // Envuelto en try/catch a propósito: fuera de Vercel (p. ej. en Vitest) el helper puede no
  // resolver nada, y un adaptador de IP nunca debe tumbar la request — si no da resultado o
  // lanza, se cae al fallback de abajo. No es una suposición sobre su comportamiento: es que
  // extraer la IP no es motivo para fallar la consulta.
  try {
    const desdePaquete = ipAddress(paraElHelper(fuente));
    if (desdePaquete) return desdePaquete;
  } catch (error) {
    console.warn('[portal] el helper de IP falló; se usa el fallback de x-forwarded-for:', error);
  }

  // Plan B (fallback documentado, spec §3): el ÚLTIMO valor de x-forwarded-for. En Vercel el
  // proxy AÑADE la IP real al final de la cadena, no la reemplaza — por eso tomar el PRIMER valor
  // sería falsificable (el atacante controla los valores de la izquierda y podría rotar la
  // cabecera en cada request para esquivar el límite). El último valor es el que puso Vercel.
  const xff = cabecerasDe(fuente).get('x-forwarded-for');
  if (xff) {
    const partes = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (partes.length > 0) return partes[partes.length - 1];
  }

  // Sin IP identificable: un solo cubo compartido. Colapsa hacia limitar (varios clientes sin IP
  // comparten cupo) en vez de hacia no-limitar — el lado seguro para un mecanismo anti-raspado.
  return 'ip-desconocida';
}

function cabecerasDe(fuente: Request | Headers): Headers {
  return fuente instanceof Headers ? fuente : fuente.headers;
}

// TRAMPA verificada en node_modules, no una precaución teórica: `ipAddress` decide si le pasaron
// una Request o unas Headers con `'headers' in input` (headers.js:59), y lo que devuelve el
// `headers()` de Next NO es un Headers común — es un adaptador que ADEMÁS expone `.headers` (el
// objeto plano de Node por debajo; adapters/headers.js). O sea que el helper se iría por la rama
// de Request y llamaría `.get()` sobre un objeto plano: TypeError en cada envío. Copiar a un
// Headers de verdad lo evita. Una Request se pasa tal cual, para no cambiarle el comportamiento a
// quien ya lo usaba.
function paraElHelper(fuente: Request | Headers): Request | Headers {
  if (!(fuente instanceof Headers)) return fuente;
  const copia = new Headers();
  fuente.forEach((valor, nombre) => copia.set(nombre, valor));
  return copia;
}
