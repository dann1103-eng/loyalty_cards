import { contadorPase } from './contadorPase';
import { describirSaldo, tipoOPuntos } from './tipos';

// Qué va en el FRENTE del pass. Puro y compartido por generatePass (Apple), construirRecursos
// (Google) y la vista previa del editor de marca: hasta el 2026-09-08 la vista previa tenía su
// propio if/else y le mostraba "PUNTOS 0" a una membresía, que en el pass real no lleva contador.
export interface CampoFrente {
  etiqueta: string;
  valor: string;
  // El mismo dato como número pelado, o null cuando `valor` es texto compuesto. Es lo que decide si
  // Apple recibe `numberStyle` (ver generatePass) y si Google manda `balance.int` (construirRecursos).
  numero: number | null;
}

// CUATRO campos con destinos DISTINTOS. Confundirlos es el error fácil de este módulo:
//
//   - `primario` y `secundario` son los campos de APPLE (primaryFields sobre la franja,
//     secondaryFields debajo). Con grilla de sellos el primario queda vacío a propósito: el texto
//     taparía los círculos.
//   - `encabezado` es el NOMBRE del pase (programas_tarjeta.nombre_pase). Va a `headerFields` en
//     Apple y a `textModulesData` en Google. No depende del tipo.
//   - `listado` es la línea ÚNICA que describe la tarjeta sin importar dónde se dibuje, y es la que
//     consume GOOGLE (`loyaltyPoints`). No es lo mismo que `primario`: en Google el texto va
//     SIEMPRE, también cuando hay grilla, porque es lo que se lee en la vista de lista de Wallet.
//     Con `hayGrilla: true` el primario es null; tomarlo ahí dejaría a Android sin el contador de
//     sellos. Y el listado ya trae la palabra ("7 de 10 sellos"), así que quien lo consuma NO debe
//     agregarla: saldría "7 de 10 sellos sellos".
export interface FrentePase {
  primario: CampoFrente | null;
  secundario: CampoFrente | null;
  encabezado: string | null;
  listado: CampoFrente | null;
}

// La etiqueta del campo cuyo valor es un ESTADO con fecha, por TIPO y no por `if` (decisión 8 del
// spec): un tipo nuevo no puede heredar "MEMBRESÍA" por descuido. `descuento` NO está acá aunque
// también tenga contador 'ninguno': su estado es un porcentaje que sale de niveles_descuento, un
// dato que el pase no recibe. Mientras no lo reciba, el frente de un descuento no lleva campo.
const ETIQUETA_VIGENCIA: Record<string, string> = {
  membresia: 'MEMBRESÍA',
  cupon: 'CUPÓN',
};

// '' y '   ' valen lo mismo que null: el pase sale sin encabezado en vez de con un campo vacío. La
// columna tiene un CHECK que ya lo impide, pero el pase lee filas que pueden venir de otra ruta.
function encabezadoDe(nombrePase: string | null): string | null {
  return (nombrePase ?? '').trim() || null;
}

export function frentePase(d: {
  tipoTarjeta: string;
  puntos: number;
  selloMeta: number | null;
  // Si la grilla de sellos EXISTE. En el pass de Apple depende de que la composición haya tenido
  // éxito y de que no haya franja propia; en Google, de que el objeto lleve su heroImage compuesta;
  // la vista previa asume composición exitosa.
  hayGrilla: boolean;
  // `tarjetas.vigencia_hasta` (AAAA-MM-DD) y `tarjetas.usado_en`: el estado de un cupón o una
  // membresía es una FECHA, no un número. null en la vista previa del editor, donde no hay ninguna
  // tarjeta emitida — y ahí describirSaldo ya dice "Sin activar" / "Disponible" sin mirar el reloj.
  vigenciaHasta: string | null;
  usadoEn: string | null;
  // `programas_tarjeta.nombre_pase`. null = el pase sale como hasta ahora.
  nombrePase: string | null;
  // El "hoy" del COMERCIO (hoyEnZona(comercio.zona_horaria)), por argumento y no con un new Date()
  // adentro: el mismo motivo que describirSaldo —probar el borde del vencimiento sin congelar el
  // reloj— y además esta función corre también dentro de un componente 'use client', donde un reloj
  // propio daría mismatch de hidratación.
  hoyIso: string;
}): FrentePase {
  const encabezado = encabezadoDe(d.nombrePase);
  const esSellos = d.tipoTarjeta === 'sellos' && d.selloMeta != null && d.selloMeta > 0;

  if (esSellos && d.hayGrilla) {
    // La grilla se VE en la franja; texto encima taparía los círculos. El contador baja al secundario.
    // El listado, en cambio, se mantiene: Google lo muestra en la vista de lista, donde no hay grilla.
    return {
      primario: null,
      secundario: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta}`, numero: null },
      encabezado,
      listado: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta} sellos`, numero: null },
    };
  }
  if (esSellos) {
    // Sin grilla el texto vuelve al primario, con la palabra: es lo único que dice qué se cuenta.
    const campo = { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta} sellos`, numero: null };
    return { primario: campo, secundario: null, encabezado, listado: campo };
  }

  // Cupón y membresía: su estado es una fecha. describirSaldo ya sabe redactarlo ("Activa hasta el
  // 12 de octubre de 2026", "Venció el 3 de agosto de 2026", "Ya usado", "Sin activar") y es la
  // MISMA función que usan el panel, el escáner y el portal del cliente: el dueño, el cajero y el
  // cliente leen la misma frase.
  const etiquetaVigencia = ETIQUETA_VIGENCIA[tipoOPuntos(d.tipoTarjeta).valor];
  if (etiquetaVigencia) {
    const campo = {
      etiqueta: etiquetaVigencia,
      valor: describirSaldo(
        {
          tipo: d.tipoTarjeta,
          contador: d.puntos,
          selloMeta: d.selloMeta,
          vigenciaHasta: d.vigenciaHasta,
          usadoEn: d.usadoEn,
        },
        d.hoyIso,
      ),
      numero: null,
    };
    return { primario: campo, secundario: null, encabezado, listado: campo };
  }

  // contadorPase decide etiqueta y formato SEGÚN EL TIPO, y devuelve null para los que no tienen
  // contador: ahí el pase no lleva número, en vez de un "PUNTOS 0" que no dice nada.
  const contador = contadorPase(d.tipoTarjeta, d.puntos, d.selloMeta);
  const campo = contador
    ? { etiqueta: contador.etiqueta, valor: contador.valor, numero: contador.numero }
    : null;
  return { primario: campo, secundario: null, encabezado, listado: campo };
}
