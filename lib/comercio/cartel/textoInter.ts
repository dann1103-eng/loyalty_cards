// Convierte el texto del cartel a CONTORNOS (<path>) con Inter, que viaja en el repo.
//
// Por qué contornos y no un <text> con la fuente embebida — las tres opciones se midieron el
// 2026-08-02 contra sharp 0.34.5 (librsvg 2.61.2), rasterizando el mismo texto con fontconfig
// aislado (cero fuentes del sistema) y contando píxeles de tinta:
//
//   · `font-family="sans-serif"` (lo que había): 2.128 px — el contorno de un cuadradito por letra.
//   · `@font-face` con la fuente en base64 dentro del SVG: 2.120 / 2.148 / 2.136 px probando cuatro
//     MIME distintos (font/ttf, application/font-ttf, application/x-font-ttf) y 0 px con
//     font/truetype. O sea: librsvg 2.61.2 IGNORA @font-face. No es una suposición, está medido —
//     los cuadraditos siguen ahí byte por byte.
//   · Un <path> plano: 40.685 px. Un contorno no consulta al sistema de fuentes, ni existe.
//
// Quedaba una cuarta opción — instalar la fuente para fontconfig en el runtime (FONTCONFIG_FILE +
// un <dir>), que también mide bien (29.039 px). Se descartó porque su corrección depende de tres
// condiciones que NINGUNA prueba de este repo puede verificar: que la variable de entorno se fije
// antes de que fontconfig se inicialice (lo hace una sola vez por proceso, perezosamente), que el
// archivo de fuente sobreviva al tracing de Next, y que haya un directorio de caché escribible. Si
// cualquiera falla, el modo de fallo es EXACTAMENTE el bug que estamos arreglando: cuadraditos, sin
// error. Los contornos, en cambio, no dependen de nada del entorno, y si la fuente faltara el
// `readFileSync` de acá abajo REVIENTA con un mensaje explícito en vez de imprimir basura callada.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, type Font } from 'opentype.js';
import { escaparXml, type DibujarTexto, type PesoTexto } from './texto';

// Inter, SIL Open Font License 1.1 (la licencia viaja al lado, en fuentes/LICENSE-Inter-OFL.txt).
// Copiadas de @expo-google-fonts/inter@0.4.2, que las publica tal cual salen de Google Fonts.
export const ARCHIVO_POR_PESO: Record<PesoTexto, string> = {
  400: 'Inter_400Regular.ttf',
  600: 'Inter_600SemiBold.ttf',
  700: 'Inter_700Bold.ttf',
};

// Mismo mecanismo que ya usa `generatePass.ts` para leer passModels/ en producción: ruta desde la
// raíz del proyecto más una entrada en `outputFileTracingIncludes` (next.config.ts). Está probado en
// Vercel — es por donde salen los .pkpass que se emiten hoy.
//
// Se exporta para que las pruebas verifiquen la ruta REAL que se abre en producción, y no una copia
// del mismo string que se desincronizaría sin que nada avise.
export function rutaDeFuente(archivo: string): string {
  return path.join(process.cwd(), 'lib', 'comercio', 'cartel', 'fuentes', archivo);
}

// opentype.js parsea una sola vez por proceso: son ~340 KB por peso y el lambda atiende varias
// descargas. El caché es a nivel de módulo, no global, así que no sobrevive a un redeploy.
const cache = new Map<PesoTexto, Font>();

function cargarFuente(peso: PesoTexto): Font {
  const yaCargada = cache.get(peso);
  if (yaCargada) return yaCargada;

  const ruta = rutaDeFuente(ARCHIVO_POR_PESO[peso]);
  let bytes: Buffer;
  try {
    bytes = readFileSync(ruta);
  } catch (causa) {
    // Ruidoso a propósito. El bug original era mudo: el PNG salía igual, con el peso esperado, solo
    // que ilegible. Preferimos un 500 en la descarga —que se ve— a un cartel impreso en cuadraditos.
    throw new Error(
      `No se encontró la fuente del cartel en ${ruta}. Sin ella el texto se imprimiría como cuadraditos: ` +
        `revisá que next.config.ts siga incluyendo lib/comercio/cartel/fuentes/ en outputFileTracingIncludes.`,
      { cause: causa },
    );
  }
  // `parse` quiere un ArrayBuffer, y el Buffer de Node suele ser una VISTA de un pool compartido más
  // grande: pasar `bytes.buffer` a secas le daría la memoria de otros archivos y el parseo fallaría.
  const fuente = parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  cache.set(peso, fuente);
  return fuente;
}

// El `aria-label` no es decoración: mantiene el texto legible para un lector de pantalla y para
// cualquiera que abra el SVG, ya que los contornos no son texto. Es lo mismo que hacen Inkscape e
// Illustrator al convertir a curvas.
export const dibujarTextoConInter: DibujarTexto = ({ texto, x, y, tamano, peso, anclaje, color }) => {
  if (texto === '') return '';
  const fuente = cargarFuente(peso);
  // `text-anchor` no existe para un <path>: el centrado se calcula acá, con el ancho real de avance
  // de la cadena en esta fuente y este cuerpo.
  const xInicial = anclaje === 'centro' ? x - fuente.getAdvanceWidth(texto, tamano) / 2 : x;
  const d = fuente.getPath(texto, xInicial, y, tamano).toPathData(2);
  return `<g aria-label="${escaparXml(texto)}"><path d="${d}" fill="${color}"/></g>`;
};
