// URL pública de la grilla de sellos compuesta por tarjeta (ver app/api/tarjetas/[tarjetaId]/hero.png).
// Google necesita poder alcanzarla desde internet para heroImage — por eso NEXT_PUBLIC_BASE_URL,
// nunca localhost. Devuelve null (no lanza) si falta: Google Wallet sigue funcionando sin la
// grilla visual (cae al conteo de texto de siempre), igual que cualquier otra imagen best-effort.
export function urlHeroTarjeta(tarjetaId: string): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/tarjetas/${tarjetaId}/hero.png`;
}
