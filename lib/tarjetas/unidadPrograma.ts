import { tipoOPuntos } from './tipos';

// Cómo se LLAMA lo que cuenta un programa: sellos, puntos o visitas.
//
// ══ POR QUÉ EXISTE ══
// La respuesta estaba escrita dos veces y las dos veces mal. `unidad()` en
// lib/apple/construirReverso.ts y las etiquetas a mano de las pantallas del dueño hacían lo mismo:
// `tipo === 'sellos' ? 'sellos' : 'puntos'`. O sea que los otros SEIS tipos se llamaban "puntos".
//
// Lo que eso producía, y que ningún typechecker podía ver porque todo son strings:
//   - Un cliente con gift card leía "Ganás 1 punto por cada visita" en el REVERSO DE SU TARJETA.
//   - Un cliente de prepago leía sus visitas restantes descritas como puntos.
//   - Un dueño de un programa de sellos veía "Costo en puntos" al cargar un premio.
//
// Es el mismo defecto que ya se cerró en `formatearSaldo`: una función cuya firma no podía expresar
// el caso. Acá la defensa es que la unidad se DERIVA del campo `contador` del catálogo (tipos.ts),
// así que un tipo nuevo no puede heredar "puntos" por descuido — hay una prueba que lo exige.

export interface Unidad {
  singular: string;
  plural: string;
}

// Solo los tipos cuyo contador son ENTEROS tienen una unidad que nombrar. Los demás devuelven null
// a propósito, y eso no es un hueco:
//   - contador 'centavos' (gift card, cashback) es DINERO: se formatea con formatearCentavos, no se
//     le pone una palabra. Escribir "2500 puntos" sobre $25.00 es exactamente el bug de origen.
//   - contador 'ninguno' (cupón, membresía, descuento) no cuenta nada: su estado es una fecha o un
//     nivel, y "0 puntos" no significa nada para el cliente.
// El null obliga al llamador a resolverlo bien en vez de recibir una palabra inventada.
const UNIDADES: Record<string, Unidad> = {
  puntos: { singular: 'punto', plural: 'puntos' },
  sellos: { singular: 'sello', plural: 'sellos' },
  // La razón de ser del módulo: prepago cuenta VISITAS.
  prepago: { singular: 'visita', plural: 'visitas' },
};

export function unidadPrograma(tipoTarjeta: string): Unidad | null {
  // tipoOPuntos degrada un valor desconocido a 'puntos' en vez de lanzar: una fila vieja o un tipo
  // escrito a mano no debe dejar una pantalla sin dibujar (misma política que el resto del módulo).
  const tipo = tipoOPuntos(tipoTarjeta);
  if (tipo.contador !== 'entero') return null;
  return UNIDADES[tipo.valor] ?? UNIDADES.puntos;
}

// La palabra que corresponde a una cantidad concreta. Singular SOLO con exactamente uno: 0 y 0.5 y
// 2 son plural. Una regla puede dar 0.5 puntos por cada dólar, y "0.5 punto" está mal escrito.
export function unidadPara(tipoTarjeta: string, cantidad: number): string | null {
  const unidad = unidadPrograma(tipoTarjeta);
  if (!unidad) return null;
  return cantidad === 1 ? unidad.singular : unidad.plural;
}
