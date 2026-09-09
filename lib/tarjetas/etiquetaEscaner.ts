import { tipoOPuntos, puedeCanjearRecompensas, type AccionPrincipal } from './tipos';

// Cómo se llama el botón que lleva del directorio de clientes (o de su ficha) AL ESCÁNER.
//
// ══ POR QUÉ EXISTE ══
// Hasta el 2026-09-08 esos dos botones decían "Acreditar / Canjear" y "Acreditar / Canjear /
// Corregir" a los OCHO tipos. El dueño de una membresía leía que iba a acreditar y canjear, y al
// entrar al escáner se encontraba con un solo botón que dice "Renovar membresía": ni canje ni
// corrección, porque en cupón, membresía y descuento no hay contador del que descontar.
//
// La regla no se reinventa acá: el verbo sale de `accionPrincipal` del catálogo (tipos.ts) —— el
// MISMO campo del que el escáner saca su botón real (`ETIQUETA_PRINCIPAL` en escanear/actions.ts,
// que no se puede importar porque vive en un archivo 'use server') —— y las dos operaciones extra
// se ofrecen exactamente cuando el escáner las ofrece:
//   - Canjear   → hay recompensas que descontar, o sea contador distinto de 'ninguno'.
//   - Corregir  → `resultado.tieneContador` en Escaner.tsx, que es esa misma condición.
// Si un tipo nuevo cambia de acción principal, el botón cambia solo.

// Keyed por ACCIÓN y no por tipo, a propósito: una segunda tabla por tipo sería justo la copia que
// se desincroniza. `Record<AccionPrincipal, …>` la deja cerrada —— una acción nueva en el catálogo
// no compila hasta que alguien le escriba su verbo, sin necesidad de una prueba de cobertura.
const VERBO: Record<AccionPrincipal, string> = {
  acreditar: 'Acreditar',
  consumir: 'Descontar',
  // 'usar' hoy es de cupón y de nadie más, y por eso el verbo puede nombrarlo. Si algún tipo nuevo
  // toma esta acción, este texto hay que volver a abrirlo.
  usar: 'Usar cupón',
  renovar: 'Renovar',
  registrar: 'Registrar compra',
};

// `conCorregir` lo pide solo la FICHA del cliente: es la pantalla del dueño, y corregir es una
// operación de dueño. El directorio, que también ve el cajero, no la anuncia.
export function etiquetaAtajoEscaner(
  tipoTarjeta: string,
  opciones: { conCorregir?: boolean } = {},
): string {
  const tipo = tipoOPuntos(tipoTarjeta);
  const partes = [VERBO[tipo.accionPrincipal]];
  // Sin contador no hay nada que descontar: ni un premio ni una corrección. Prometerlos manda al
  // dueño a una pantalla donde esos botones no existen.
  if (puedeCanjearRecompensas(tipoTarjeta)) {
    partes.push('Canjear');
    if (opciones.conCorregir) partes.push('Corregir');
  }
  return partes.join(' / ');
}
