// El NOMBRE DEL PASE (`programas_tarjeta.nombre_pase`, migración 0033): lo que el cliente lee arriba
// en su tarjeta para saber cuál de todas es. Opcional — vacío = el pase sale como hasta ahora.
//
// NO se reusa `programas_tarjeta.nombre`: el programa principal nace llamándose como el comercio
// (0024, `c.nombre`), así que mostrarlo sería repetir el nombre del negocio que ya está en el logo.
//
// Vive en su propio módulo, como validarColorRgb, porque lo validan DOS escrituras distintas
// (guardarBranding, que escribe el programa principal, y guardarBrandingPrograma, que escribe uno
// elegido) y el formulario necesita el mismo tope para su `maxLength`. Tres copias divergen sin que
// nada avise.

// El mismo tope que el CHECK de la 0033. La base es la red de seguridad, no la defensa: un 23514
// mudo llega a la pantalla como "No se pudo guardar el branding" y el dueño no sabe qué corregir
// (misma razón que ya documentan el difuminado y el encuadre).
export const LARGO_MAXIMO_NOMBRE_PASE = 40;

// Devuelve el mensaje de error, o null si está bien. Misma forma que validarEncuadre.
// `null` es un valor VÁLIDO: significa "sin nombre", que es como nace todo programa.
export function validarNombrePase(nombrePase: string | null): string | null {
  if (nombrePase === null) return null;
  const limpio = nombrePase.trim();
  if (limpio === '') {
    // Los formularios ya mandan null cuando el campo queda vacío; esto atrapa a cualquier otro
    // llamador, y sobre todo al espacio en blanco, que el CHECK de la base también rechaza.
    return 'El nombre del pase no puede quedar en blanco.';
  }
  if (limpio.length > LARGO_MAXIMO_NOMBRE_PASE) {
    return `El nombre del pase no puede pasar de ${LARGO_MAXIMO_NOMBRE_PASE} caracteres.`;
  }
  return null;
}
