import { tipoOPuntos } from './tipos';

// Qué número ve el cliente en la cara de su pase, y con qué etiqueta. Módulo PURO y compartido por
// las dos plataformas (lib/apple/generatePass.ts y lib/google/construirRecursos.ts) para que Apple
// y Google no puedan divergir en algo que el cliente lee de un vistazo.
//
// Existe por un bug real: hasta el 2026-07-30 el pase dibujaba TODO lo que no fuera sellos como
// `label: 'PUNTOS', value: puntos_actuales`. Pero gift card y cashback guardan CENTAVOS en esa
// misma columna (ver el campo `contador` de TIPOS), así que una gift card de $25.00 le mostraba al
// cliente "PUNTOS 2500": unidad equivocada y dos ceros de más.
export interface ContadorPase {
  etiqueta: string;
  valor: string;
  // El mismo dato como número PELADO, o null cuando `valor` es texto compuesto ("$25.00", "3 de 8").
  // Existe para Google, cuyo `balance` acepta `int` y en ese caso le pone los separadores de miles
  // según la configuración regional del teléfono. Aplanar todo a string funcionaría, pero le haría
  // perder ese formato a un saldo de 12345 puntos sin ninguna ganancia a cambio.
  numero: number | null;
}

// La etiqueta sale del TIPO, no de la unidad: 'prepago' y 'puntos' son los dos enteros, pero uno
// cuenta visitas y el otro puntos. Un tipo que no esté acá cae al default de más abajo.
const ETIQUETAS: Record<string, string> = {
  puntos: 'PUNTOS',
  sellos: 'SELLOS',
  prepago: 'VISITAS',
  gift_card: 'SALDO',
  cashback: 'SALDO',
};

// Centavos → "$25.00". Se formatea con enteros y se pega el punto a mano: dividir entre 100 y usar
// toFixed(2) pasa por punto flotante, que es justo lo que el resto del módulo de dinero evita
// (ver centavosDesdeTexto).
function dolares(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(Math.trunc(centavos));
  const enteros = Math.floor(absoluto / 100);
  const resto = absoluto % 100;
  return `${signo}$${enteros}.${String(resto).padStart(2, '0')}`;
}

// Devuelve null cuando el tipo no tiene contador (cupón, membresía, descuento): su estado es una
// fecha o un nivel, no un número. Mostrar "PUNTOS 0" ahí no significaría nada para el cliente.
export function contadorPase(
  tipoTarjeta: string,
  puntos: number,
  selloMeta: number | null,
): ContadorPase | null {
  const tipo = tipoOPuntos(tipoTarjeta);
  const etiqueta = ETIQUETAS[tipo.valor] ?? 'PUNTOS';

  if (tipo.contador === 'ninguno') return null;
  // El dinero NUNCA es `numero`: "2500" como entero es exactamente el bug que este módulo cierra.
  if (tipo.contador === 'centavos') return { etiqueta, valor: dolares(puntos), numero: null };

  // Entero. Los sellos CON meta se leen "3 de 8"; sin meta configurada cae al entero pelado en vez
  // de decir "3 de null".
  if (tipo.valor === 'sellos' && selloMeta != null && selloMeta > 0) {
    return { etiqueta, valor: `${puntos} de ${selloMeta}`, numero: null };
  }
  return { etiqueta, valor: String(puntos), numero: puntos };
}
