/**
 * Normaliza un teléfono al formato canónico +<código de país><dígitos>.
 * Es la forma en que `clientes.telefono` se almacena SIEMPRE (es la llave de
 * identidad global — ver spec §4): sin normalizar, "7777-1234" y "77771234"
 * crearían dos clientes distintos para la misma persona.
 *
 * Entradas aceptadas:
 * - Con '+': se respeta el código de país que trae (8–15 dígitos, tope E.164).
 * - Sin '+': SOLO un local salvadoreño de exactamente 8 dígitos (asume +503) o
 *   11 dígitos que empiezan con 503. Cualquier otra longitud lanza error — un
 *   typo de 9 dígitos NO debe convertirse silenciosamente en otro país.
 */
export function normalizarTelefono(entrada: string): string {
  const traePlus = entrada.trim().startsWith('+');
  const digitos = entrada.replace(/\D/g, '');

  if (traePlus) {
    if (digitos.length < 8 || digitos.length > 15) {
      throw new Error(`Teléfono inválido: "${entrada}"`);
    }
    return `+${digitos}`;
  }

  if (digitos.length === 8) {
    return `+503${digitos}`;
  }

  if (digitos.length === 11 && digitos.startsWith('503')) {
    return `+${digitos}`;
  }

  throw new Error(`Teléfono inválido: "${entrada}"`);
}
