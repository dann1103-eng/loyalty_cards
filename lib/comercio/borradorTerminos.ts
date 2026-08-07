import { tipoOPuntos } from '../tarjetas/tipos';
import { unidadPrograma } from '../tarjetas/unidadPrograma';

// El borrador de términos de uso que el dueño inserta con un botón en Marca y que termina TAL CUAL
// en el reverso de la tarjeta de cada uno de sus clientes.
//
// ══ POR QUÉ ESTO NO ERA UN PROBLEMA DE REDACCIÓN ══
// Antes era un solo texto con `esSellos ? 'sellos' : 'puntos'` metido adentro, así que a un comercio
// de gift card le proponía escribirle a sus clientes:
//
//   "1. Los puntos no tienen valor monetario y no se canjean por efectivo."
//   "2. Los puntos no vencen."
//
// La primera línea es FALSA en una gift card: el saldo es plata, ese es el producto entero. La
// segunda es falsa en un cupón y en una membresía, que vencen por diseño. Es texto cuasi-legal en
// la tarjeta de un cliente, y el dueño lo pega confiando en que dice algo razonable.
//
// Ahora las dos primeras líneas salen del TIPO y el resto es común. Las comunes valen para los ocho
// y por eso siguen escritas una sola vez.
//
// Lo que el borrador NO hace, y es deliberado: no repite cómo se ganan los sellos ni qué se canjea.
// De eso ya se encarga la sección automática del reverso, que se arma en cada emisión desde
// `reglas_puntos` y `recompensas` — duplicarlo acá es justo lo que se desactualiza.

// Las que valen para cualquier tipo de tarjeta.
const COMUNES = [
  'La tarjeta es personal: no se transfiere ni se combina con otras.',
  'Las recompensas están sujetas a disponibilidad.',
  'No acumulable con otras promociones.',
];

// Lo que se puede afirmar con verdad sobre CADA tipo. Se devuelven sin numerar: la numeración se
// arma al final, así ninguna rama puede dejar un hueco.
function lineasDelTipo(tipoTarjeta: string): string[] {
  const tipo = tipoOPuntos(tipoTarjeta);
  const unidad = unidadPrograma(tipo.valor);

  // Sellos, puntos y visitas: un contador que no es dinero y que no caduca.
  if (unidad) {
    // El artículo viaja CON la palabra (ver Unidad): "Las visitas", no "Los visitas".
    return [
      `${unidad.articulo} ${unidad.plural} no tienen valor monetario y no se canjean por efectivo.`,
      `${unidad.articulo} ${unidad.plural} no vencen.`,
    ];
  }

  // Gift card y cashback. NO se dice "no tiene valor monetario" porque sí lo tiene; lo que protege
  // al comercio y además es cierto es que se gasta ahí y no se devuelve en efectivo.
  if (tipo.contador === 'centavos') {
    return [
      'El saldo se usa solo en este comercio y no se cambia por efectivo.',
      'El saldo no se transfiere a otra tarjeta ni a otra persona.',
    ];
  }

  if (tipo.valor === 'cupon') {
    return [
      'El cupón se usa una sola vez y vence en la fecha que aparece en la tarjeta.',
      'No se cambia por efectivo ni se reemplaza si vence sin usarse.',
    ];
  }

  if (tipo.valor === 'membresia') {
    return [
      'La membresía vale hasta la fecha que aparece en la tarjeta y se renueva en el local.',
      'No se cambia por efectivo ni se devuelve el período ya pagado.',
    ];
  }

  // Descuento por nivel.
  return [
    'El descuento se aplica sobre el precio de lista al momento de pagar.',
    'El nivel depende del total acumulado y puede cambiar si se ajustan los niveles.',
  ];
}

export function borradorTerminos(tipoTarjeta: string, nombreComercio: string): string {
  const lineas = [
    ...lineasDelTipo(tipoTarjeta),
    ...COMUNES,
    `${nombreComercio} puede modificar o terminar el programa avisando en el local.`,
  ];
  // La numeración se arma acá y no dentro de cada rama: así agregar o quitar una línea no puede
  // dejar un hueco en el texto que el dueño pega tal cual en la tarjeta de sus clientes.
  return lineas.map((linea, i) => `${i + 1}. ${linea}`).join('\n');
}
