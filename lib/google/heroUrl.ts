import crypto from 'node:crypto';

// URL pública de la grilla de sellos compuesta por tarjeta (ver app/api/tarjetas/[tarjetaId]/hero.png).
// Google necesita poder alcanzarla desde internet para heroImage — por eso NEXT_PUBLIC_BASE_URL,
// nunca localhost. Devuelve null (no lanza) si falta: Google Wallet sigue funcionando sin la
// grilla visual (cae al conteo de texto de siempre), igual que cualquier otra imagen best-effort.
//
// EL `?v=` NO ES DECORATIVO: Google descarga la imagen UNA vez y la cachea en su CDN. Si la URL
// no cambia, sigue mostrando la grilla vieja para siempre aunque el saldo suba — bug real visto en
// producción (el contador decía "3 de 8" y la grilla seguía con los 8 sellos vacíos). La versión
// resume TODO lo que altera la imagen: al cambiar cualquiera de esos datos, cambia la URL y Google
// vuelve a bajarla. Mismo truco que ya usa el bucket de imágenes del comercio con `?v=<timestamp>`.
export function urlHeroTarjeta(tarjetaId: string, version: string): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/tarjetas/${tarjetaId}/hero.png?v=${version}`;
}

export interface DatosVersionHero {
  puntos: number;
  selloMeta: number | null;
  colorFondo: string | null;
  colorLabel: string | null;
  selloIconoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  difuminadoFranja: string;
}

// Hash corto de todo lo que la composición dibuja. Determinístico a propósito: la misma tarjeta con
// los mismos datos da la misma URL (Google no re-descarga de gusto), y cualquier cambio —un sello
// más, otro ícono, otro color— la cambia.
export function versionHero(d: DatosVersionHero): string {
  const clave = JSON.stringify([
    d.puntos, d.selloMeta, d.colorFondo, d.colorLabel,
    d.selloIconoUrl, d.heroUrl, d.stripUrl, d.difuminadoFranja,
  ]);
  return crypto.createHash('sha1').update(clave).digest('hex').slice(0, 12);
}
