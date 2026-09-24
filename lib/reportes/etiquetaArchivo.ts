// El nombre del comercio como parte del NOMBRE de un archivo descargado: "Panadería La Peña" →
// "panaderia-la-pena". Lo usan las dos descargas del panel, el Excel de Reportes
// (reportes/exportar/route.ts) y la lista de clientes en CSV o .xlsx (clientes/exportar/route.ts).
//
// El nombre lo escribió el dueño y termina en una cabecera HTTP (Content-Disposition): unas comillas o
// un salto de línea la partirían, y un carácter fuera de Latin-1 (un ☕) la vuelve inválida y la ruta
// responde 500. Por eso la salida es ASCII PURO: minúsculas, dígitos y guiones sueltos, nunca uno al
// principio ni al final.
//
// Los acentos se SEPARAN antes del saneo (NFD: "í" es "i" + U+0301, "ñ" es "n" + U+0303) y se tiran las
// marcas. Sin ese paso, el saneo cambiaba cada letra acentuada por un guion: "Panadería La Peña" quedaba
// "panader-a-la-pe-a" y "Ñandú", "and". Una letra que NFD no descompone (ß, æ, ø) sigue cayendo al
// guion, como cualquier otro símbolo.
//
// Un nombre del que no queda nada (solo emoji o signos) da RESPALDO, el mismo que tenían las dos rutas:
// "reportes--2026-….xlsx" o "clientes-.csv" parecerían un error.
//
// Y se corta en MAXIMO caracteres: el nombre del comercio no tiene largo máximo (validar() solo exige
// que no esté vacío), y en el Excel de Reportes le siguen el período y la extensión. Un nombre de
// archivo de más de 255 bytes el sistema no lo acepta, y el navegador lo recorta por donde le parece.

const RESPALDO = 'comercio';
const MAXIMO = 60;

export function etiquetaDeArchivo(nombre: string): string {
  const etiqueta = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, MAXIMO)
    // El corte puede caer justo en un guion: no queda colgando.
    .replace(/-$/, '');
  return etiqueta || RESPALDO;
}
