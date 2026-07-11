import crypto from 'node:crypto';

// Compara en tiempo constante el token del header `Authorization: ApplePass <token>` contra
// el apple_auth_token almacenado de la tarjeta. Lo usan los endpoints del PassKit Web Service
// que requieren autenticación: registro/desregistro de dispositivo (Tarea 9) y "último pass".
// La comparación de longitud no filtra el contenido del token, solo su tamaño (32 hex chars,
// constante en la práctica); timingSafeEqual exige buffers de igual longitud.
export function verificarApplePassToken(authHeader: string | null, tokenAlmacenado: string): boolean {
  const recibido = (authHeader ?? '').replace(/^ApplePass\s+/i, '');
  const a = Buffer.from(recibido);
  const b = Buffer.from(tokenAlmacenado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
