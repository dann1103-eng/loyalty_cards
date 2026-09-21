import { createHmac, timingSafeEqual } from 'node:crypto';

// Firmas de Wompi. Todo es HMAC-SHA256 en hexadecimal con el API Secret del negocio como llave.
//
// El contenido se firma como BYTES, no como texto: `Request.text()` decodifica UTF-8 y descarta un
// BOM inicial, y con un byte de diferencia el HMAC ya no coincide. Quien llama pasa el cuerpo tal cual
// llegó (`new Uint8Array(await request.arrayBuffer())`).

export function firmaHmac(contenido: Uint8Array | string, secreto: string): string {
  return createHmac('sha256', secreto).update(contenido).digest('hex');
}

// Compara en tiempo constante y en minúsculas (Wompi puede mandar el hexadecimal en mayúsculas).
// `timingSafeEqual` LANZA si los largos difieren, así que se chequea antes: una firma corta o vacía es
// simplemente inválida, no una excepción que tumbe la ruta.
export function firmaValida(
  recibida: string | null | undefined,
  contenido: Uint8Array | string,
  secreto: string,
): boolean {
  if (!recibida) return false;
  const esperada = Buffer.from(firmaHmac(contenido, secreto), 'utf8');
  const dada = Buffer.from(recibida.trim().toLowerCase(), 'utf8');
  if (esperada.length !== dada.length) return false;
  return timingSafeEqual(esperada, dada);
}

// Los parámetros de la URL a la que Wompi devuelve al pagador tras un ENLACE de pago. Van como TEXTO,
// tal como llegaron: `10` no es `10.00`, y reformatear el monto cambiaría el hash.
export interface ParametrosRedirect {
  identificadorEnlaceComercio: string;
  idTransaccion: string;
  idEnlace: string;
  monto: string;
}

// El hash del redirect de un enlace es el HMAC de estos cuatro valores CONCATENADOS, sin separador y
// en ESTE orden (página "Validar Parámetros URL Redirect" de la doc de Wompi).
//
// OJO: la página de "Crear Enlace de Pago" describe otro hash, de siete campos, que un redirect de
// enlace ni siquiera trae. La doc se contradice; se implementa la variante de cuatro y la página de
// vuelta NO depende de esto: la verdad es la consulta a la API. Ver la spec, "A verificar".
export function textoHashRedirect(p: ParametrosRedirect): string {
  return p.identificadorEnlaceComercio + p.idTransaccion + p.idEnlace + p.monto;
}

export function hashRedirectValido(
  p: ParametrosRedirect & { hash: string | null | undefined },
  secreto: string,
): boolean {
  return firmaValida(p.hash, textoHashRedirect(p), secreto);
}
