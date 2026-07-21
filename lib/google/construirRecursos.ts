import type { walletobjects_v1 } from 'googleapis/build/src/apis/walletobjects/v1';
import { rgbAHex } from './colorHex';

// Insumos mínimos para armar una LoyaltyClass: solo lo que la clase realmente usa (no el row
// completo de `comercios`), para que estas funciones sean puras y fáciles de testear sin DB.
export interface ComercioParaClase {
  nombre: string;
  colorFondo: string | null;
  logoUrl: string; // requerido: programLogo es obligatorio en la API (ver syncClase.ts, que
  // filtra ANTES de llamar aquí a los comercios sin logo — Google no tiene el fallback de
  // logoText que sí usa Apple).
  heroUrl: string | null;
}

// reviewStatus 'UNDER_REVIEW' (no 'draft'): un draft no puede usarse para crear objetos.
// Cuentas Admin/Developer del propio Emisor SÍ pueden agregar passes de clases underReview
// sin esperar el acceso de publicación (spec §3 del diseño, verificado contra la guía oficial
// de onboarding). [Fuente: google-wallet/rest-samples/nodejs/demo-loyalty.js]
export function construirClase(classId: string, comercio: ComercioParaClase): walletobjects_v1.Schema$LoyaltyClass {
  const hex = rgbAHex(comercio.colorFondo);
  return {
    id: classId,
    issuerName: comercio.nombre,
    programName: comercio.nombre,
    reviewStatus: 'UNDER_REVIEW',
    programLogo: { sourceUri: { uri: comercio.logoUrl } },
    ...(comercio.heroUrl ? { heroImage: { sourceUri: { uri: comercio.heroUrl } } } : {}),
    ...(hex ? { hexBackgroundColor: hex } : {}),
  };
}

export interface TarjetaParaObjeto {
  qrToken: string;
  puntosActuales: number;
  tipoTarjeta: string;
  selloMeta: number | null;
}

// Sellos como texto ("7 de 10 sellos"): loyaltyPoints.balance no tiene un modo "grilla visual"
// — es la misma limitación de plataforma que Apple tuvo antes del pipeline de imágenes, salvo
// que para Google no existe forma de componer una imagen distinta por cliente en el punto de
// guardado sin una ruta pública que la sirva (fuera de alcance de este walking skeleton; ver
// docs/superpowers/specs/2026-07-20-google-wallet-walking-skeleton-design.md).
function loyaltyPointsDe(t: TarjetaParaObjeto): walletobjects_v1.Schema$LoyaltyPoints {
  if (t.tipoTarjeta === 'sellos' && t.selloMeta != null && t.selloMeta > 0) {
    return { label: 'Sellos', balance: { string: `${t.puntosActuales} de ${t.selloMeta} sellos` } };
  }
  return { label: 'Puntos', balance: { int: t.puntosActuales } };
}

export function construirObjeto(
  objectId: string,
  classId: string,
  tarjeta: TarjetaParaObjeto,
): walletobjects_v1.Schema$LoyaltyObject {
  return {
    id: objectId,
    classId,
    state: 'ACTIVE',
    barcode: { type: 'QR_CODE', value: tarjeta.qrToken },
    loyaltyPoints: loyaltyPointsDe(tarjeta),
  };
}
