import crypto from 'node:crypto';
import type { Encuadre } from '../comercio/encuadreFranja';

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

// URL pública de la BANDA DE MARCA compuesta para la portada de la LoyaltyClass (ver
// app/api/comercios/[comercioId]/franja.png). Mismo `?v=` de cache-busting que urlHeroTarjeta y por
// el mismo motivo: Google descarga la imagen una vez y la cachea por URL. `programa` va ANTES de `v`
// para que la URL sea estable y comparable en las pruebas.
export function urlFranjaClase(comercioId: string, programaId: string | null, version: string): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;
  const programa = programaId ? `programa=${encodeURIComponent(programaId)}&` : '';
  return `${base}/api/comercios/${comercioId}/franja.png?${programa}v=${version}`;
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
  encuadreFranja: Encuadre;
}

// Hash corto de todo lo que la composición dibuja. Determinístico a propósito: la misma tarjeta con
// los mismos datos da la misma URL (Google no re-descarga de gusto), y cualquier cambio —un sello
// más, otro ícono, otro color, otro encuadre de la foto— la cambia.
export function versionHero(d: DatosVersionHero): string {
  const clave = JSON.stringify([
    d.puntos, d.selloMeta, d.colorFondo, d.colorLabel,
    d.selloIconoUrl, d.heroUrl, d.stripUrl, d.difuminadoFranja,
    d.encuadreFranja.modo, d.encuadreFranja.focoX, d.encuadreFranja.focoY, d.encuadreFranja.zoom,
  ]);
  return crypto.createHash('sha1').update(clave).digest('hex').slice(0, 12);
}

// La versión del hero de UNA TARJETA (el `?v=` de urlHeroTarjeta), para los DOS caminos que arman su
// objeto: syncObjetoTarjeta y el objeto embebido en el JWT de generarLinkGuardar. Si cada uno armara
// su `?v=`, Google haría upsert del JWT con otra URL y volvería a bajar la imagen en cada "Agregar a
// Google Wallet".
//
// Los puntos y la meta entran SOLO cuando la imagen depende de ellos: la GRILLA (sellos con meta y
// sin franja propia, la misma condición con la que componerStrips la dibuja). Desde el 2026-09-17
// todos los tipos llevan hero en Google (spec, decisión 8), y la franja propia y la banda de marca
// no cambian al operar: con los puntos en el hash, Google re-descargaría la misma imagen en cada
// compra (hasta 2 MB con una franja propia). Fuera de la grilla se hashea con progreso cero, sin
// meta — y todo lo demás de la marca, que sí altera la imagen, sigue entrando.
export function versionHeroTarjeta(
  marca: Omit<DatosVersionHero, 'puntos' | 'selloMeta'>,
  tipoTarjeta: string,
  puntos: number,
  selloMeta: number | null,
): string {
  const esGrilla = tipoTarjeta === 'sellos' && selloMeta != null && selloMeta > 0 && !marca.stripUrl;
  return esGrilla
    ? versionHero({ ...marca, puntos, selloMeta })
    : versionHero({ ...marca, puntos: 0, selloMeta: null });
}

// La versión de la portada de CLASE: la misma banda que dibuja la ruta franja.png, o sea sin
// progreso (puntos 0, sin meta), sin ícono de sello y sin franja propia. Vive acá y no en cada sync
// para que la ruta y los dos syncs no puedan hashear cosas distintas.
export function versionFranjaClase(marca: {
  colorFondo: string | null;
  colorLabel: string | null;
  heroUrl: string | null;
  difuminadoFranja: string;
  encuadreFranja: Encuadre;
}): string {
  return versionHero({
    puntos: 0,
    selloMeta: null,
    colorFondo: marca.colorFondo,
    colorLabel: marca.colorLabel,
    selloIconoUrl: null,
    heroUrl: marca.heroUrl,
    stripUrl: null,
    difuminadoFranja: marca.difuminadoFranja,
    encuadreFranja: marca.encuadreFranja,
  });
}

// La portada que va en la clase: la compuesta si hay foto y base URL; la foto cruda si falta la base
// (degradación); null sin foto. UNA función para los TRES lugares que construyen la clase
// (syncClase, syncClasePrograma y la clase EMBEBIDA en el JWT de linkGuardar, que Google upsertea
// por id). Si cada uno armara su URL, bastaría con que uno hasheara otros campos para que Google
// re-descargara la misma imagen en cada llamada — o peor, para que un camino devolviera la clase a
// la foto cruda deshaciendo lo que los otros dos lograron.
export function heroUrlDeClase(
  comercioId: string,
  programaId: string | null,
  marca: { colorFondo: string | null; colorLabel: string | null; heroUrl: string | null; difuminadoFranja: string; encuadreFranja: Encuadre },
): string | null {
  if (!marca.heroUrl) return null;
  return urlFranjaClase(comercioId, programaId, versionFranjaClase(marca)) ?? marca.heroUrl;
}
