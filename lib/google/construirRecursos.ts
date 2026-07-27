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
  // URL pública de la grilla de sellos COMPUESTA PARA ESTA TARJETA (ver lib/google/heroUrl.ts).
  // Ya no es solo texto: heroImage existe también a nivel de LoyaltyObject (no solo de clase,
  // corrección al diseño original — ver memoria del proyecto), así que cada cliente puede ver su
  // propio progreso visual, igual que en Apple. Solo se usa para sellos (ver construirObjeto);
  // en puntos queda sin heroImage propio y se ve el de la clase (foto de fondo del comercio).
  heroImageUrl?: string | null;
}

// El texto ("7 de 10 sellos") queda SIEMPRE como loyaltyPoints, incluso con grilla visual: es lo
// que se lee en la vista de lista de Wallet (donde no cabe la imagen) y el respaldo si la
// composición de la grilla falla.
function loyaltyPointsDe(t: TarjetaParaObjeto): walletobjects_v1.Schema$LoyaltyPoints {
  if (t.tipoTarjeta === 'sellos' && t.selloMeta != null && t.selloMeta > 0) {
    return { label: 'Sellos', balance: { string: `${t.puntosActuales} de ${t.selloMeta} sellos` } };
  }
  return { label: 'Puntos', balance: { int: t.puntosActuales } };
}

function esSellosConMeta(t: TarjetaParaObjeto): boolean {
  return t.tipoTarjeta === 'sellos' && t.selloMeta != null && t.selloMeta > 0;
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
    ...(esSellosConMeta(tarjeta) && tarjeta.heroImageUrl
      ? { heroImage: { sourceUri: { uri: tarjeta.heroImageUrl } } }
      : {}),
  };
}
