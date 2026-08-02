// Cómo se dibuja CADA texto del cartel. Es un punto de extensión y no una constante porque los dos
// consumidores de las plantillas viven en mundos con capacidades distintas:
//
//   · El navegador (vista previa en vivo del editor) TIENE fuentes: le alcanza un <text> normal y no
//     pagar ni un byte extra de bundle.
//   · El runtime serverless de Vercel NO tiene NINGUNA fuente instalada: un <text> ahí se rasteriza
//     como un cuadradito por letra (bug de producción del 2026-08-02). Ese lado convierte el texto a
//     contornos con la fuente que el repo trae — ver textoInter.ts.
//
// El parámetro es OBLIGATORIO en construirCartelSvg a propósito: si tuviera un valor por defecto,
// el camino que se olvidara de pasarlo volvería al <text> y el cartel saldría otra vez en
// cuadraditos, sin error y sin que nada lo delate. Así el compilador obliga a elegir.

// Se escapan los 5 caracteres especiales de XML antes de interpolar CUALQUIER texto libre (nombre
// del comercio, CTA, teaser) dentro del SVG — mismo requisito que ya estableció el spec del reverso
// de la tarjeta (docs/superpowers/specs/2026-07-26-reverso-tarjeta-configurable-design.md §7.1) para
// HTML. Sin esto, un nombre con "&" rompe el XML entero (pantalla en blanco en la vista previa).
export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Los tres pesos que usan las plantillas. No es una lista abierta: cada peso cuesta un archivo de
// fuente en el repo y en el bundle serverless, así que agregar uno es una decisión, no un descuido.
export const PESOS_TEXTO = [400, 600, 700] as const;
export type PesoTexto = (typeof PESOS_TEXTO)[number];

export interface OpcionesTexto {
  texto: string;
  x: number;
  // Línea BASE, igual que el atributo `y` de un <text> de SVG (no el borde superior).
  y: number;
  tamano: number;
  peso: PesoTexto;
  // 'centro' = el text-anchor="middle" de SVG; 'inicio' = el default (text-anchor="start").
  anclaje: 'inicio' | 'centro';
  color: string;
}

export type DibujarTexto = (opciones: OpcionesTexto) => string;

// La familia que pide la vista previa. Se nombra Inter primero para que el navegador use la MISMA
// tipografía con la que el servidor va a imprimir, si la tiene; si no, cae a la del sistema.
export const FAMILIA_VISTA_PREVIA = 'Inter, system-ui, sans-serif';

// Vista previa del navegador: un <text> de toda la vida. Sirve SOLO donde hay fuentes instaladas.
export const dibujarTextoConFuenteDelSistema: DibujarTexto = ({
  texto,
  x,
  y,
  tamano,
  peso,
  anclaje,
  color,
}) =>
  `<text x="${x}" y="${y}" text-anchor="${anclaje === 'centro' ? 'middle' : 'start'}" font-family="${FAMILIA_VISTA_PREVIA}" font-size="${tamano}" font-weight="${peso}" fill="${color}">${escaparXml(texto)}</text>`;
