// IDs de Google Wallet: deben ser únicos por emisor y solo alfanuméricos, '.', '_' o '-'.
// [Fuente: developers.google.com/wallet/retail/loyalty-cards/rest/v1/loyaltyclass#resource — verificado 2026-07-20]
// Nuestros UUID (con guiones) ya cumplen ese charset, así que se usan directo, sin transformar.
export function idClaseGoogle(issuerId: string, comercioId: string): string {
  return `${issuerId}.comercio_${comercioId}`;
}

export function idObjetoGoogle(issuerId: string, tarjetaId: string): string {
  return `${issuerId}.tarjeta_${tarjetaId}`;
}
