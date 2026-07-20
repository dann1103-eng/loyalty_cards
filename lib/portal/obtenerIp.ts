import { ipAddress } from '@vercel/functions';

// Extrae la IP del cliente. La fuente confiable en Vercel es el helper del paquete oficial
// (@vercel/functions), que resuelve la cadena de proxies correctamente.
//
// Firma CONFIRMADA contra el paquete instalado (headers.d.ts:95):
//   export declare function ipAddress(input: Request | Headers): string | undefined;
export function obtenerIp(request: Request): string {
  // Envuelto en try/catch a propósito: fuera de Vercel (p. ej. en Vitest) el helper puede no
  // resolver nada, y un adaptador de IP nunca debe tumbar la request — si no da resultado o
  // lanza, se cae al fallback de abajo. No es una suposición sobre su comportamiento: es que
  // extraer la IP no es motivo para fallar la consulta.
  try {
    const desdePaquete = ipAddress(request);
    if (desdePaquete) return desdePaquete;
  } catch (error) {
    console.warn('[portal] el helper de IP falló; se usa el fallback de x-forwarded-for:', error);
  }

  // Plan B (fallback documentado, spec §3): el ÚLTIMO valor de x-forwarded-for. En Vercel el
  // proxy AÑADE la IP real al final de la cadena, no la reemplaza — por eso tomar el PRIMER valor
  // sería falsificable (el atacante controla los valores de la izquierda y podría rotar la
  // cabecera en cada request para esquivar el límite). El último valor es el que puso Vercel.
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const partes = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (partes.length > 0) return partes[partes.length - 1];
  }

  // Sin IP identificable: un solo cubo compartido. Colapsa hacia limitar (varios clientes sin IP
  // comparten cupo) en vez de hacia no-limitar — el lado seguro para un mecanismo anti-raspado.
  return 'ip-desconocida';
}
