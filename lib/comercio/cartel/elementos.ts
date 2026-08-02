// Elementos LIBRES del cartel (migración 0030): textos y franjas de color que el dueño coloca donde
// quiera, encima de lo que dibuja la plantilla. Puro — sin Supabase, sin fetch, sin DOM.
//
// TODAS las coordenadas y tamaños son PORCENTAJES del lienzo (0–100), nunca unidades de diseño. El
// motivo es que el MISMO diseño se imprime en dos formatos de proporción distinta (sticker cuadrado
// de 10×10 cm y mostrador A5 de 148×210 mm), y el dueño elige el formato AL DESCARGAR, después de
// haber colocado sus elementos. Con unidades absolutas, un texto puesto al pie del sticker quedaría
// flotando a media hoja en el A5 — o directamente fuera del papel. Con porcentajes, "abajo a la
// derecha" sigue siendo abajo a la derecha en los dos.
import { rgbDesdeTexto } from '../colorHex';
import { PESOS_TEXTO, type DibujarTexto, type PesoTexto } from './texto';

// `type` y no `interface`, y no es estilo: TypeScript le da índice implícito a un alias de tipo pero
// NO a una interfaz, así que una interfaz no es asignable a `Json` (el tipo de la columna jsonb)
// aunque estructuralmente lo sea. Con `interface` acá, guardar exigiría un `as unknown as Json` en
// la Server Action — un cast que apaga al compilador justo en el borde donde escribimos a la base.
export type ElementoTexto = {
  tipo: 'texto';
  texto: string;
  // Centro horizontal, % del ancho. Los extras SIEMPRE se anclan por su centro: con un control de
  // posición, "movelo a la izquierda" es la única lectura intuitiva, y evita el bug clásico de
  // alinear a la izquierda un texto que el dueño creía centrado.
  x: number;
  // Línea BASE, % del alto (igual que el atributo `y` de un <text> de SVG, no el borde superior).
  y: number;
  // Cuerpo de la letra, % del ALTO del lienzo — la misma referencia que usan las plantillas
  // (h * 0.032 y compañía), así que un extra se ve en escala con el texto fijo del cartel.
  tamano: number;
  color: string;
  peso: PesoTexto;
};

export type ElementoFranja = {
  tipo: 'franja';
  // Esquina superior izquierda, % del ancho/alto.
  x: number;
  y: number;
  ancho: number;
  alto: number;
  color: string;
  // Redondeo de las esquinas, % del lado MENOR de la franja (50 = píldora perfecta).
  radio: number;
};

export type ElementoCartel = ElementoTexto | ElementoFranja;

// Tope espejo del CHECK de la migración 0030. Los dos se mueven juntos: si acá sube y allá no, el
// guardado revienta con un error de constraint que la pantalla no sabe explicar.
export const MAX_ELEMENTOS = 12;

export const LIMITES_TEXTO = { tamano: { min: 1, max: 15 }, largo: 60 } as const;
export const LIMITES_FRANJA = { lado: { min: 0.5, max: 100 }, radio: { min: 0, max: 50 } } as const;

// Un número finito FUERA de rango se recorta (un control deslizante no puede producirlo: si llegó,
// es de una edición a mano o de un redondeo, y recortar respeta la intención). Lo que NO es número
// devuelve null y hace caer al elemento entero — ver el comentario de `sanearElementos`.
function numeroEnRango(valor: unknown, min: number, max: number): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return null;
  return Math.min(max, Math.max(min, valor));
}

function textoLimpio(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim().slice(0, LIMITES_TEXTO.largo);
  return limpio === '' ? null : limpio;
}

function pesoValido(valor: unknown): PesoTexto {
  return (PESOS_TEXTO as readonly number[]).includes(valor as number) ? (valor as PesoTexto) : 400;
}

// Lee lo que venga de la columna jsonb (o del formulario) y devuelve SOLO elementos que se pueden
// dibujar. Es la única defensa real: la 0030 nada más garantiza que sea una lista acotada, y de acá
// sale texto y color que se interpolan dentro de un SVG.
//
// Un elemento con cualquier campo obligatorio ilegible se DESCARTA entero, no se arregla. Inventarle
// un color a una franja pintaría sobre el cartel algo que el dueño no eligió nunca; inventarle una
// posición a un texto lo pondría encima del QR. Desaparecer es el único modo de fallo honesto acá:
// se nota, y no arruina un cartel que ya se está por mandar a la imprenta.
export function sanearElementos(valor: unknown): ElementoCartel[] {
  if (!Array.isArray(valor)) return [];

  const salida: ElementoCartel[] = [];
  for (const crudo of valor.slice(0, MAX_ELEMENTOS)) {
    if (typeof crudo !== 'object' || crudo === null) continue;
    const e = crudo as Record<string, unknown>;

    // El color se valida con el MISMO traductor que usa el selector de la pantalla: si `rgbDesdeTexto`
    // no lo entiende, no es un color que el resto del sistema sepa leer.
    const color = typeof e.color === 'string' ? rgbDesdeTexto(e.color) : null;
    if (!color) continue;

    const x = numeroEnRango(e.x, 0, 100);
    const y = numeroEnRango(e.y, 0, 100);
    if (x === null || y === null) continue;

    if (e.tipo === 'texto') {
      const texto = textoLimpio(e.texto);
      const tamano = numeroEnRango(e.tamano, LIMITES_TEXTO.tamano.min, LIMITES_TEXTO.tamano.max);
      if (texto === null || tamano === null) continue;
      salida.push({ tipo: 'texto', texto, x, y, tamano, color, peso: pesoValido(e.peso) });
      continue;
    }

    if (e.tipo === 'franja') {
      const ancho = numeroEnRango(e.ancho, LIMITES_FRANJA.lado.min, LIMITES_FRANJA.lado.max);
      const alto = numeroEnRango(e.alto, LIMITES_FRANJA.lado.min, LIMITES_FRANJA.lado.max);
      const radio = numeroEnRango(e.radio, LIMITES_FRANJA.radio.min, LIMITES_FRANJA.radio.max);
      if (ancho === null || alto === null || radio === null) continue;
      salida.push({ tipo: 'franja', x, y, ancho, alto, color, radio });
    }
  }
  return salida;
}

// Las franjas van DEBAJO de todo lo que dibuja la plantilla, y no es una preferencia estética: la
// tarjeta blanca del QR se dibuja después, así que una franja NUNCA puede tapar el QR. Un cartel con
// el código tapado se imprime igual, se ve bien y no escanea — el peor modo de fallo posible acá, y
// se descubriría con 500 stickers ya pegados en las mesas.
export function dibujarFranjas(elementos: ElementoCartel[], w: number, h: number): string {
  return elementos
    .filter((e): e is ElementoFranja => e.tipo === 'franja')
    .map((f) => {
      const ancho = (f.ancho / 100) * w;
      const alto = (f.alto / 100) * h;
      // El radio se mide contra el lado MENOR: con el mayor, una franja finita y larga al 50%
      // pediría un redondeo más grande que su propia altura y SVG lo recorta solo — el resultado se
      // ve arbitrario y distinto según la proporción.
      const radio = (f.radio / 100) * Math.min(ancho, alto);
      return `<rect x="${((f.x / 100) * w).toFixed(2)}" y="${((f.y / 100) * h).toFixed(2)}" width="${ancho.toFixed(2)}" height="${alto.toFixed(2)}" rx="${radio.toFixed(2)}" fill="${f.color}"/>`;
    })
    .join('');
}

// Los textos van ENCIMA de todo: un extra puesto sobre la foto de fondo o sobre una franja propia
// tiene que leerse, y si el dueño lo pone sobre el QR lo ve en la vista previa antes de imprimir.
export function dibujarTextosExtra(
  elementos: ElementoCartel[],
  w: number,
  h: number,
  dibujarTexto: DibujarTexto,
): string {
  return elementos
    .filter((e): e is ElementoTexto => e.tipo === 'texto')
    .map((t) =>
      dibujarTexto({
        texto: t.texto,
        x: (t.x / 100) * w,
        y: (t.y / 100) * h,
        tamano: (t.tamano / 100) * h,
        peso: t.peso,
        anclaje: 'centro',
        color: t.color,
      }),
    )
    .join('');
}
