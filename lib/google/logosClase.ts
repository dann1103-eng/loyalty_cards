import crypto from 'node:crypto';
import type { Medidas } from '../comercio/encuadreFranja';
import type { LogosClase } from './construirRecursos';
import { baseParaImagenesGoogle } from './baseUrlPublica';
import { medidasLogo } from './logoRemoto';

// Los logos de la LoyaltyClass de Google (spec 2026-09-23, §2 "Google Wallet"): el `programLogo` que
// Google recorta en círculo y, si el logo es apaisado, el `wideProgramLogo`. Los dos se sirven
// COMPUESTOS desde app/api/comercios/[comercioId]/logo.png y logo-ancho.png (ver componerLogo.ts):
// la URL cruda del logo, recortado al ras y de ≤ 480 px, dejaba a "Pulso CAFÉ" cortado y diminuto.
//
// UN SOLO LUGAR para las URLs, como heroUrlDeClase: la usan los TRES caminos que construyen la clase
// (syncClase, syncClasePrograma y la clase EMBEBIDA en el JWT de linkGuardar, que Google upsertea por
// id). Si cada uno armara la suya, bastaría con que uno hasheara distinto para que Google re-descargara
// el logo en cada llamada, o para que un camino devolviera la clase al logo crudo.

// Desde qué proporción (ancho / alto) un logo es "ancho" y la clase suma el `wideProgramLogo`. Por
// debajo, el logo ya se ve grande dentro del círculo (un 4:3 ocupa 462×347 px del área segura de 462),
// y el logo ancho solo le quitaría a la tarjeta el nombre del negocio de la cabecera por defecto.
export const PROPORCION_LOGO_ANCHO = 1.6;

export function esLogoAncho(medidas: Medidas): boolean {
  return medidas.alto > 0 && medidas.ancho / medidas.alto >= PROPORCION_LOGO_ANCHO;
}

export interface MarcaLogo {
  logoUrl: string;
  colorFondo: string | null;
}

// Sube de a UNO cuando cambia CÓMO se componen los logos (componerLogo.ts), no qué datos se usan: el
// hash solo mira los datos, así que sin esto una composición nueva conservaría la URL vieja y Google
// seguiría sirviendo para siempre la imagen que ya tenía cacheada. Historia:
//   1 — 2026-09-23: primera composición (cuadrado 660 con el 70 % de área segura; ancho 1280×400).
const VERSION_COMPOSICION_LOGO = 1;

// El `?v=` de los dos logos (cache-busting, regla del proyecto: Google cachea cada imagen por URL).
// Resume todo lo que altera la imagen: la URL del logo —que ya trae su propio `?v=<timestamp>` del
// bucket, así que re-subirlo la cambia—, el color de fondo del cuadrado y la versión de la
// composición. El logo ancho es transparente y no depende del color, pero comparte la versión: un
// cambio de color le cuesta a Google UNA descarga de más de esa imagen, y a cambio no hay dos hashes que
// mantener de acuerdo con la ruta.
export function versionLogoClase(marca: MarcaLogo): string {
  const clave = JSON.stringify([VERSION_COMPOSICION_LOGO, marca.logoUrl, marca.colorFondo]);
  return crypto.createHash('sha1').update(clave).digest('hex').slice(0, 12);
}

// `programa` va ANTES de `v`, como en urlFranjaClase: URL estable y comparable en las pruebas.
function urlLogo(
  base: string,
  archivo: 'logo.png' | 'logo-ancho.png',
  comercioId: string,
  programaId: string | null,
  version: string,
): string {
  const programa = programaId ? `programa=${encodeURIComponent(programaId)}&` : '';
  return `${base}/api/comercios/${comercioId}/${archivo}?${programa}v=${version}`;
}

// PURA: recibe las medidas ya resueltas (o null si no se pudieron medir) y decide. Así las pruebas de
// las URLs no dependen de la red.
//
// `programaId` es el de la clase que se está armando: null para la del comercio, el id del programa
// para la clase PROPIA de un programa (la ruta resuelve con él la marca efectiva). `marca` tiene que
// ser la de ESA clase.
//
// Los tres casos del logo ancho (ver LogosClase en construirRecursos.ts, y por qué importa en un
// `patch`): ancho → URL; medido y NO ancho → null, para borrar uno anterior; sin medidas → la clave se
// OMITE, para que un error pasajero no agregue ni quite nada.
//
// Sin base URL PÚBLICA (desarrollo: `http://localhost:3000`) se degrada al logo crudo del bucket, que sí
// es público, y sin logo ancho: una imagen de la clase apuntando a localhost hace que Google rechace el
// patch ENTERO (`400 Image cannot be loaded`).
export function logosDeClase(
  comercioId: string,
  programaId: string | null,
  marca: MarcaLogo,
  medidas: Medidas | null,
): LogosClase {
  const base = baseParaImagenesGoogle();
  if (!base) return { programLogo: marca.logoUrl };

  const version = versionLogoClase(marca);
  const programLogo = urlLogo(base, 'logo.png', comercioId, programaId, version);
  if (!medidas) return { programLogo };
  return {
    programLogo,
    wideProgramLogo: esLogoAncho(medidas) ? urlLogo(base, 'logo-ancho.png', comercioId, programaId, version) : null,
  };
}

// Mide el logo (solo si hay base pública: sin ella no hay logo ancho que decidir, y una descarga de
// hasta 2 s en cada sync no serviría para nada) y arma los logos con logosDeClase. Es lo que llaman los
// tres caminos que construyen la clase. No lanza: medidasLogo devuelve null ante cualquier fallo.
export async function resolverLogosClase(
  comercioId: string,
  programaId: string | null,
  marca: MarcaLogo,
): Promise<LogosClase> {
  const medidas = baseParaImagenesGoogle() ? await medidasLogo(marca.logoUrl) : null;
  return logosDeClase(comercioId, programaId, marca, medidas);
}
