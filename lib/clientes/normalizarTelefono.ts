/**
 * Normaliza un teléfono al formato canónico +<código de país><dígitos>.
 * Es la forma en que `clientes.telefono` se almacena SIEMPRE (es la llave de
 * identidad global — ver spec §4): sin normalizar, "7777-1234" y "77771234"
 * crearían dos clientes distintos para la misma persona.
 * Números locales de 8 dígitos asumen El Salvador (+503).
 */
export function normalizarTelefono(entrada: string): string {
  const traePlus = entrada.trim().startsWith('+');
  const digitos = entrada.replace(/\D/g, '');

  if (traePlus) {
    if (digitos.length < 8) {
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

  if (digitos.length >= 8) {
    // Trae más dígitos que un local pero sin '+': lo tratamos como si incluyera código de país.
    return `+${digitos}`;
  }

  throw new Error(`Teléfono inválido: "${entrada}"`);
}
