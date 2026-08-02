// La frase que el cartel propone según lo que la tarjeta HACE. Puro — lo importa también el
// navegador (el editor la usa de placeholder y para el botón "usar la sugerida").
//
// Por qué existe: hasta acá TODO cartel nacía diciendo "¡Escaneá y sumate!", que no le dice al
// cliente qué gana. El dueño de una cafetería con tarjeta de sellos y el de una tienda con cashback
// imprimían literalmente el mismo llamado a la acción. El cartel es lo ÚNICO que ve alguien que
// todavía no es cliente: si no dice qué se lleva, no hay motivo para sacar el teléfono.
//
// Es una SUGERENCIA, no una regla: es el valor inicial del campo, y el dueño lo puede reescribir
// entero. Por eso vive acá y no en un CHECK de la base.
import { TIPOS } from '@/lib/tarjetas/tipos';

// Voseo salvadoreño, igual que el resto de la aplicación ("Escaneá", "sumate"). El sujeto es el
// CLIENTE que todavía no se registró, no el comercio.
export const CTA_POR_TIPO: Record<string, string> = {
  sellos: 'Acumulá sellos y ganá',
  puntos: 'Acumulá puntos y ganá premios',
  cashback: 'Acumulá saldo con tus compras',
  prepago: 'Comprá tu paquete y usalo cuando querás',
  gift_card: 'Llevá tu saldo siempre a mano',
  cupon: 'Escaneá y llevate tu cupón',
  membresia: 'Hacete miembro y aprovechá',
  descuento: 'Mientras más comprás, más descuento',
};

// El de siempre: sigue siendo el default de la columna `disenos_cartel.texto_cta` (migración 0028) y
// la red de seguridad si algún día entra un tipo nuevo sin frase propia.
export const CTA_GENERICO = '¡Escaneá y sumate!';

export function ctaSugerido(tipo: string | null | undefined): string {
  return (tipo && CTA_POR_TIPO[tipo]) || CTA_GENERICO;
}

// Espejo del catálogo real. Se exporta para que la prueba pueda recorrerlo sin volver a importar
// TIPOS, y para que quede claro que este módulo depende del catálogo y no de una lista suelta.
export const TIPOS_CON_CTA = TIPOS.map((t) => t.valor);
