// IDs de Google Wallet: deben ser únicos por emisor y solo alfanuméricos, '.', '_' o '-'.
// [Fuente: developers.google.com/wallet/retail/loyalty-cards/rest/v1/loyaltyclass#resource — verificado 2026-07-20]
// Nuestros UUID (con guiones) ya cumplen ese charset, así que se usan directo, sin transformar.
export function idClaseGoogle(issuerId: string, comercioId: string): string {
  return `${issuerId}.comercio_${comercioId}`;
}

export function idObjetoGoogle(issuerId: string, tarjetaId: string): string {
  return `${issuerId}.tarjeta_${tarjetaId}`;
}

// Clase PROPIA de un programa (migración 0027). Prefijo `programa_` distinto de `comercio_` a
// propósito: los dos ids conviven en el mismo emisor y un choque sería IRREPARABLE, porque las
// clases de Google no se pueden borrar (la API no tiene delete).
export function idClasePrograma(issuerId: string, programaId: string): string {
  return `${issuerId}.programa_${programaId}`;
}
