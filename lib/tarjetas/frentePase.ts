import { contadorPase } from './contadorPase';

// Qué va en el FRENTE del pass: el campo primario (Apple lo dibuja SOBRE la franja de un storeCard)
// y el secundario (debajo). Puro y compartido por generatePass y la vista previa del editor de
// marca: hasta el 2026-09-08 la vista previa tenía su propio if/else y le mostraba "PUNTOS 0" a una
// membresía, que en el pass real no lleva ningún contador.
export interface CampoFrente {
  etiqueta: string;
  valor: string;
  // El mismo dato como número pelado, o null cuando `valor` es texto compuesto. Es lo que decide si
  // Apple recibe `numberStyle` (ver generatePass).
  numero: number | null;
}

export interface FrentePase {
  primario: CampoFrente | null;
  secundario: CampoFrente | null;
}

export function frentePase(d: {
  tipoTarjeta: string;
  puntos: number;
  selloMeta: number | null;
  // Si la grilla de sellos EXISTE en la franja. En el pass depende de que la composición haya
  // tenido éxito y de que no haya franja propia; la vista previa asume composición exitosa.
  hayGrilla: boolean;
}): FrentePase {
  const esSellos = d.tipoTarjeta === 'sellos' && d.selloMeta != null && d.selloMeta > 0;

  if (esSellos && d.hayGrilla) {
    // La grilla se VE en la franja; texto encima taparía los círculos. El contador baja al secundario.
    return {
      primario: null,
      secundario: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta}`, numero: null },
    };
  }
  if (esSellos) {
    // Sin grilla el texto vuelve al primario, con la palabra: es lo único que dice qué se cuenta.
    return {
      primario: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta} sellos`, numero: null },
      secundario: null,
    };
  }

  // contadorPase decide etiqueta y formato SEGÚN EL TIPO, y devuelve null para los que no tienen
  // contador: ahí el pase no lleva número, en vez de un "PUNTOS 0" que no dice nada.
  const contador = contadorPase(d.tipoTarjeta, d.puntos, d.selloMeta);
  return {
    primario: contador ? { etiqueta: contador.etiqueta, valor: contador.valor, numero: contador.numero } : null,
    secundario: null,
  };
}
