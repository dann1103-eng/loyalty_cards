// Países que un cliente puede elegir al registrarse. Nace de que la plataforma empieza a tomar
// comercios fuera de El Salvador y `normalizarTelefono` asumía +503 para todo número local.
//
// Cada entrada trae los LARGOS NACIONALES válidos, no solo el código de marcado. Eso es lo que
// preserva la garantía original de normalizarTelefono: "un typo de 9 dígitos NO debe convertirse
// silenciosamente en otro país". Sin los largos, elegir Guatemala y teclear 7 dígitos produciría un
// +502 inválido que nadie detectaría hasta que el cliente no reciba nada.
//
// La lista es curada a propósito, no exhaustiva: agregar un país es una línea, y una lista de 200
// entradas en un <select> de un formulario que se llena en el mostrador es peor experiencia que
// diez opciones bien elegidas.

export interface Pais {
  // Código de marcado sin '+'. NO es único: EE.UU. y Canadá comparten el 1.
  codigo: string;
  // Identificador estable para el <select>, porque `codigo` no alcanza (ver arriba).
  clave: string;
  nombre: string;
  bandera: string;
  // Cantidades de dígitos válidas para el número nacional (sin el código de país).
  largos: number[];
  // Ejemplo real de formato local, para el placeholder del campo.
  ejemplo: string;
}

export const PAISES: readonly Pais[] = [
  { clave: 'SV', codigo: '503', nombre: 'El Salvador', bandera: '🇸🇻', largos: [8], ejemplo: '7777 1234' },
  { clave: 'GT', codigo: '502', nombre: 'Guatemala', bandera: '🇬🇹', largos: [8], ejemplo: '5555 1234' },
  { clave: 'HN', codigo: '504', nombre: 'Honduras', bandera: '🇭🇳', largos: [8], ejemplo: '9999 1234' },
  { clave: 'NI', codigo: '505', nombre: 'Nicaragua', bandera: '🇳🇮', largos: [8], ejemplo: '8888 1234' },
  { clave: 'CR', codigo: '506', nombre: 'Costa Rica', bandera: '🇨🇷', largos: [8], ejemplo: '8888 1234' },
  { clave: 'PA', codigo: '507', nombre: 'Panamá', bandera: '🇵🇦', largos: [7, 8], ejemplo: '6666 1234' },
  { clave: 'BZ', codigo: '501', nombre: 'Belice', bandera: '🇧🇿', largos: [7], ejemplo: '622 1234' },
  { clave: 'MX', codigo: '52', nombre: 'México', bandera: '🇲🇽', largos: [10], ejemplo: '55 1234 5678' },
  { clave: 'CO', codigo: '57', nombre: 'Colombia', bandera: '🇨🇴', largos: [10], ejemplo: '300 123 4567' },
  { clave: 'PE', codigo: '51', nombre: 'Perú', bandera: '🇵🇪', largos: [9], ejemplo: '912 345 678' },
  { clave: 'EC', codigo: '593', nombre: 'Ecuador', bandera: '🇪🇨', largos: [9], ejemplo: '99 123 4567' },
  { clave: 'DO', codigo: '1', nombre: 'República Dominicana', bandera: '🇩🇴', largos: [10], ejemplo: '809 123 4567' },
  { clave: 'CL', codigo: '56', nombre: 'Chile', bandera: '🇨🇱', largos: [9], ejemplo: '9 1234 5678' },
  { clave: 'AR', codigo: '54', nombre: 'Argentina', bandera: '🇦🇷', largos: [10], ejemplo: '11 1234 5678' },
  { clave: 'US', codigo: '1', nombre: 'Estados Unidos', bandera: '🇺🇸', largos: [10], ejemplo: '305 123 4567' },
  { clave: 'ES', codigo: '34', nombre: 'España', bandera: '🇪🇸', largos: [9], ejemplo: '612 34 56 78' },
] as const;

// El Salvador sigue siendo el default: es el mercado actual y el país de TODOS los clientes ya
// registrados. Cambiar este default reescribiría el significado de los teléfonos guardados.
export const PAIS_DEFAULT = 'SV';
export const CODIGO_PAIS_DEFAULT = '503';

export function buscarPaisPorClave(clave: string): Pais | null {
  return PAISES.find((p) => p.clave === clave) ?? null;
}

// Los largos válidos de un código de marcado, uniendo los de todos los países que lo comparten
// (el 1 de EE.UU. y República Dominicana, por ejemplo). Se usa para validar cuando lo único que se
// tiene es el código y no el país elegido.
export function largosDeCodigo(codigo: string): number[] {
  const largos = new Set<number>();
  for (const pais of PAISES) {
    if (pais.codigo === codigo) pais.largos.forEach((l) => largos.add(l));
  }
  return [...largos];
}
