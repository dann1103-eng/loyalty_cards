// La caja donde se dibuja el logo del comercio en el cartel (Tarea 3, spec 2026-09-23 "Cartel del
// QR"). Función pura — mismo patrón que arrastre.ts: entra en números, sale en números, sin SVG ni
// DOM, así que se prueba sin tocar sharp ni un navegador.
//
// El ALTO de la caja es SIEMPRE el `lado` que ya reservaba el cuadrado de hoy: nada de lo que va
// DEBAJO del logo (nombre, QR) puede moverse un píxel por adoptar esta función. El ANCHO crece con
// la proporción real del logo (ancho/alto de la imagen que subió el dueño) hasta un tope que decide
// cada combinación de plantilla × formato — un logo horizontal como "Pulso CAFÉ" (~3:1) ya no sale
// recortado por los costados, que es lo que hacía `xMidYMid slice` sobre una caja cuadrada.
import type { Medidas } from '../encuadreFranja';

export interface CajaLogo {
  ancho: number;
  alto: number;
}

// Un logo VERTICAL (p. ej. 1:3, más alto que ancho) da una proporción < 1 y por lo tanto una caja
// MÁS ANGOSTA que `lado` — no una caja cuadrada con el logo chico adentro. Se decidió así, en vez de
// forzar el cuadrado, por dos razones:
//
//   1. No cambia ni un píxel de lo que se ve. `preserveAspectRatio="xMidYMid meet"` centra la
//      imagen DENTRO de la caja sin estirarla, así que una caja cuadrada de lado×lado con un logo
//      1:3 adentro dibuja la imagen en el mismo rectángulo (lado/3 de ancho × lado de alto),
//      centrado — el resto de la caja cuadrada queda transparente y nadie lo nota. Forzar el
//      cuadrado sería más código para el mismo resultado.
//   2. El ancho que devuelve la función pasa a describir el espacio que el logo REALMENTE ocupa,
//      que es justo lo que necesita quien tenga que dejarle lugar a algo al lado — por eso
//      `split × sticker` (el nombre a la derecha del logo) no necesita un caso aparte: le alcanza
//      con pasar `anchoMaximo = lado` para que la caja nunca CREZCA más allá del cuadrado de hoy: un
//      logo ancho se acota a lado (ver spec, "la caja SIGUE CUADRADA"), y uno angosto se angosta
//      igual que en cualquier otra combinación — nunca empuja el nombre, que es la única razón por
//      la que ese sitio no deja crecer la caja.
//
// Sin medidas (sharp no pudo leer el logo, o todavía no se subió ninguno) la caja es cuadrada, con
// `meet` en vez del `slice` de antes: mismo tamaño de siempre, ya no recorta si en el futuro alguien
// pasa una imagen sin medir.
export function cajaLogo(lado: number, anchoMaximo: number, medidas: Medidas | null): CajaLogo {
  if (!medidas || !(medidas.ancho > 0) || !(medidas.alto > 0)) {
    return { ancho: lado, alto: lado };
  }
  const proporcion = medidas.ancho / medidas.alto;
  return { ancho: Math.min(lado * proporcion, anchoMaximo), alto: lado };
}
