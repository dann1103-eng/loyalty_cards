// Tipos y dimensiones del cartel/QR (migración 0028). Puro — sin Supabase, sin fetch, sin DOM.

export const PLANTILLAS_CARTEL = ['centrado', 'split', 'foto'] as const;
export type PlantillaCartel = (typeof PLANTILLAS_CARTEL)[number];

export function esPlantillaCartel(valor: unknown): valor is PlantillaCartel {
  return typeof valor === 'string' && (PLANTILLAS_CARTEL as readonly string[]).includes(valor);
}

export const FORMATOS_CARTEL = ['sticker', 'mostrador'] as const;
export type FormatoCartel = (typeof FORMATOS_CARTEL)[number];

// Todo lo que necesita construirCartelSvg, YA resuelto: ninguna URL remota (ver §4.1 del spec — un
// renderizador SVG del lado servidor puede no cargar referencias externas, así que el logo/foto
// SIEMPRE llegan como data: URI, nunca como URL pública).
export interface DatosCartel {
  nombreComercio: string;
  plantilla: PlantillaCartel;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  logoDataUri: string | null;
  fotoDataUri: string | null;
  textoCta: string;
  textoTeaser: string | null;
  urlRegistro: string;
}

interface DimensionCartel {
  mm: { ancho: number; alto: number };
  // Tamaño de rasterizado a 300dpi — ver lib/comercio/cartel/export.ts.
  px: { ancho: number; alto: number };
  // Tamaño de página del PDF, en puntos (72pt = 1 pulgada).
  pt: { ancho: number; alto: number };
  // Unidades de diseño del <svg viewBox="0 0 ancho alto">. El ancho es fijo (400) en los dos
  // formatos; el alto se DERIVA de la proporción física real (mm), nunca se hardcodea — así el
  // viewBox nunca puede desincronizarse de la proporción real del papel.
  viewBox: { ancho: number; alto: number };
}

const MM_POR_PULGADA = 25.4;
const DPI_EXPORTACION = 300;
const PT_POR_PULGADA = 72;
const ANCHO_DISENO = 400;

function calcularDimension(anchoMm: number, altoMm: number): DimensionCartel {
  const pulgadasAncho = anchoMm / MM_POR_PULGADA;
  const pulgadasAlto = altoMm / MM_POR_PULGADA;
  return {
    mm: { ancho: anchoMm, alto: altoMm },
    px: {
      ancho: Math.round(pulgadasAncho * DPI_EXPORTACION),
      alto: Math.round(pulgadasAlto * DPI_EXPORTACION),
    },
    pt: {
      ancho: Number((pulgadasAncho * PT_POR_PULGADA).toFixed(2)),
      alto: Number((pulgadasAlto * PT_POR_PULGADA).toFixed(2)),
    },
    viewBox: { ancho: ANCHO_DISENO, alto: Number(((ANCHO_DISENO * altoMm) / anchoMm).toFixed(2)) },
  };
}

export const DIMENSIONES_CARTEL: Record<FormatoCartel, DimensionCartel> = {
  sticker: calcularDimension(100, 100),
  mostrador: calcularDimension(148, 210),
};
