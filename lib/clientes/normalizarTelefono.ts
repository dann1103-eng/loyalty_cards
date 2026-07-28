import { buscarPaisPorClave, largosDeCodigo, PAIS_DEFAULT, CODIGO_PAIS_DEFAULT } from './paises';

/**
 * Normaliza un teléfono al formato canónico +<código de país><dígitos>.
 * Es la forma en que `clientes.telefono` se almacena SIEMPRE (es la llave de
 * identidad global — ver spec §4): sin normalizar, "7777-1234" y "77771234"
 * crearían dos clientes distintos para la misma persona.
 *
 * Entradas aceptadas:
 * - Con '+': se respeta el código de país que trae (8–15 dígitos, tope E.164).
 *   No se valida contra el país elegido: si alguien escribe su número completo,
 *   ése manda.
 * - Sin '+': se le antepone el código del país elegido, PERO solo si la cantidad
 *   de dígitos es una de las válidas para ese país. Un typo de 9 dígitos NO debe
 *   convertirse silenciosamente en otro número — esa garantía es la razón de que
 *   `paises.ts` guarde los largos nacionales y no solo el código de marcado.
 * - Sin '+' pero YA con el código de país adelante ("50377771234"): se acepta si
 *   lo que queda después del código es un largo válido.
 *
 * `clavePais` es la clave de `PAISES` (p. ej. 'SV', 'GT'). Por defecto El Salvador,
 * que es el país de todos los clientes registrados hasta la migración a
 * multi-país: cambiar ese default reescribiría el significado de los teléfonos
 * ya guardados.
 */
export function normalizarTelefono(entrada: string, clavePais: string = PAIS_DEFAULT): string {
  const traePlus = entrada.trim().startsWith('+');
  const digitos = entrada.replace(/\D/g, '');

  if (traePlus) {
    if (digitos.length < 8 || digitos.length > 15) {
      throw new Error(`Teléfono inválido: "${entrada}"`);
    }
    return `+${digitos}`;
  }

  // Un país desconocido cae a El Salvador en vez de lanzar: el valor viene de un <select> del
  // formulario y, si alguna vez llegara uno viejo o manipulado, es mejor comportarse como antes de
  // esta feature que dejar al cliente sin poder registrarse.
  const pais = buscarPaisPorClave(clavePais);
  const codigo = pais?.codigo ?? CODIGO_PAIS_DEFAULT;
  const largos = pais?.largos ?? largosDeCodigo(CODIGO_PAIS_DEFAULT);

  if (largos.includes(digitos.length)) {
    return `+${codigo}${digitos}`;
  }

  // Ya trae el código de país adelante, sin el '+'.
  if (digitos.startsWith(codigo)) {
    const resto = digitos.slice(codigo.length);
    if (largos.includes(resto.length)) {
      return `+${digitos}`;
    }
  }

  throw new Error(`Teléfono inválido: "${entrada}"`);
}
