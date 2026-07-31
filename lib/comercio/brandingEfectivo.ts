// Resuelve el branding que se le muestra al cliente para UNA tarjeta: lo del programa si lo tiene,
// lo del comercio si no. Función PURA para que los nueve consumidores compartan una sola definición
// de "efectivo" y no puedan divergir — que es exactamente lo que pasó dos veces en julio de 2026
// cuando el tipo de tarjeta se mudó al programa y quedaron consumidores leyendo la columna legada.
export interface BrandingBase {
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  difuminadoFranja: string;
}

// El programa define lo que quiera y hereda el resto. `brandingPropio` es el interruptor maestro.
export type BrandingPrograma = Partial<BrandingBase> & { brandingPropio: boolean };

export function brandingEfectivo(
  comercio: BrandingBase,
  programa: BrandingPrograma | null,
): BrandingBase {
  // Sin programa, o con el interruptor apagado: todo del comercio. El booleano manda SOBRE los
  // campos a propósito — así apagar el branding propio no obliga al dueño a limpiar cada columna, y
  // volver a encenderlo le devuelve lo que había configurado.
  if (!programa || !programa.brandingPropio) return comercio;

  // `??` acá SÍ es correcto: para el branding, null significa "no lo definí, heredá" y no existe un
  // "color nulo legítimo".
  //
  // OJO — esto NO se puede copiar para `sello_meta`, donde null es un valor VÁLIDO (un cupón no
  // tiene meta). Escribir `programa.sello_meta ?? comercio.sello_meta` hace que un cupón herede la
  // meta del comercio y el pase le dibuje una grilla de sellos. Es un bug real del 2026-07-30, que
  // la prueba atrapó con "expected 8 to be null". Ese campo cuelga del PROGRAMA entero, no del
  // valor — ver lib/apple/datosPassDeTarjeta.ts.
  return {
    colorFondo: programa.colorFondo ?? comercio.colorFondo,
    colorTexto: programa.colorTexto ?? comercio.colorTexto,
    colorLabel: programa.colorLabel ?? comercio.colorLabel,
    logoUrl: programa.logoUrl ?? comercio.logoUrl,
    heroUrl: programa.heroUrl ?? comercio.heroUrl,
    stripUrl: programa.stripUrl ?? comercio.stripUrl,
    selloIconoUrl: programa.selloIconoUrl ?? comercio.selloIconoUrl,
    difuminadoFranja: programa.difuminadoFranja ?? comercio.difuminadoFranja,
  };
}

// Los TRES campos que Google guarda en la LoyaltyClass (ver construirClase): color de fondo, logo e
// imagen de portada. Solo estos justifican crearle una clase propia a un programa.
//
// Por qué la regla es fina y no "tiene cualquier branding propio": los otros cinco campos viven en
// el .pkpass de Apple y en el heroImage del OBJETO, que ya es por tarjeta. Con la regla amplia, un
// dueño que solo cambia el ícono del sello de su cupón generaría una LoyaltyClass PERMANENTE —
// las clases de Google no se pueden borrar, la API no tiene delete— que no le sirve para nada.
export function necesitaClasePropia(
  programa: {
    brandingPropio: boolean;
    colorFondo: string | null;
    logoUrl: string | null;
    heroUrl: string | null;
  } | null,
): boolean {
  if (!programa || !programa.brandingPropio) return false;
  return programa.colorFondo !== null || programa.logoUrl !== null || programa.heroUrl !== null;
}
