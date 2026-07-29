// Los nueve stickers del kit de marca, en un solo lugar.
//
// Son PURAMENTE DECORATIVOS: van con `aria-hidden` y `alt=""` en todos sus usos, y el CSS les pone
// `pointer-events: none`. Ninguno carga información que no esté escrita en texto al lado, así que
// esconderlos en pantalla angosta (lo que hace `.pegatina`) no le quita nada a nadie.
//
// El `ancho`/`alto` son las dimensiones INTRÍNSECAS del PNG, no el tamaño con el que se pintan (eso
// lo decide `--ancho-pegatina` en el CSS). Next los necesita para reservar el espacio y no provocar
// un salto de layout cuando cada sticker termina de cargar.

export interface Sticker {
  archivo: string;
  ancho: number;
  alto: number;
}

export const STICKERS = {
  yeah: { archivo: '/_inicio/sticker-yeah.webp', ancho: 444, alto: 295 },
  hechaParaGanar: { archivo: '/_inicio/sticker-hecha-para-ganar.webp', ancho: 444, alto: 295 },
  pasaElBalon: { archivo: '/_inicio/sticker-pasa-el-balon.webp', ancho: 444, alto: 295 },
  bienvenido: { archivo: '/_inicio/sticker-bienvenido.webp', ancho: 444, alto: 295 },
  woah: { archivo: '/_inicio/sticker-woah.webp', ancho: 444, alto: 295 },
  iconic: { archivo: '/_inicio/sticker-iconic.webp', ancho: 444, alto: 295 },
  futuro: { archivo: '/_inicio/sticker-futuro.webp', ancho: 444, alto: 295 },
  evolucion: { archivo: '/_inicio/sticker-evolucion.webp', ancho: 444, alto: 295 },
  tasteThis: { archivo: '/_inicio/sticker-taste-this.webp', ancho: 444, alto: 295 },
} as const satisfies Record<string, Sticker>;
