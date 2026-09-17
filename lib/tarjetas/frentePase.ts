import { contadorPase } from './contadorPase';
import { describirSaldo, sigueVigente, tipoOPuntos } from './tipos';
import { formatearFechaCorta } from './vigencia';

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

// Lo que el QR lleva DEBAJO, en todos los pases de todos los comercios y en las dos billeteras
// (Apple `altText`, Google `alternateText`, y la vista previa). Literal a propósito: `MARCA.nombre`
// de lib/marca.ts vale 'Cardly SV', y el diseño dice "Cardly".
export const PIE_CODIGO = 'Powered by Cardly';

// Qué hay DE VERDAD en la franja del pase, no qué subió el comercio (spec 2026-09-17, "La franja,
// en tres estados"):
//   - 'propia': la imagen de franja del comercio LLEGÓ al pase. Trae su texto dibujado.
//   - 'grilla': sellos con meta, sin franja propia, y la grilla compuesta existe.
//   - 'banda':  cualquier otro caso — la banda de marca, o no hay franja porque la composición o la
//               descarga fallaron.
// "Llegó al pase" y no "el comercio subió una": si la descarga de la franja propia falla, el pase
// sale SIN franja, y tratarlo como 'propia' lo dejaría también sin el nombre del pase.
export type Franja = 'propia' | 'grilla' | 'banda';

// CUATRO lugares con destinos DISTINTOS. Confundirlos es el error fácil de este módulo:
//
//   - `estado`: arriba a la DERECHA, al lado del logo. Apple `headerFields`; Google fila 1, derecha.
//     El contador del tipo o, en cupón y membresía, la fecha CORTA ("VÁLIDO HASTA · 16/10/2026").
//   - `sobreFranja`: el nombre del pase (programas_tarjeta.nombre_pase), SOLO sobre la banda lisa.
//     Apple `primaryFields`; Google fila 1, izquierda. En 'propia' la imagen ya trae su texto; en
//     'grilla' taparía los círculos.
//   - `titular`: NOMBRE y APELLIDO debajo de la franja. Apple `secondaryFields`; Google fila 2.
//   - `listado`: la línea ÚNICA que describe la tarjeta sin importar dónde se dibuje, y es la que
//     consume GOOGLE (`loyaltyPoints` y la vista de lista de Wallet, donde no hay grilla). No es
//     `estado`: los sellos llevan la palabra ("7 de 10 sellos") y cupón y membresía la frase larga de
//     describirSaldo. Quien lo consuma NO debe agregar la palabra: saldría "7 de 10 sellos sellos".
//
// Los lugares viejos (`primario`, `secundario`, `encabezado`) se ELIMINARON en vez de dejarlos
// convivir: un consumidor que siguiera leyéndolos dibujaría el orden anterior sin que el compilador
// lo marcara.
export interface FrentePase {
  estado: CampoFrente | null;
  sobreFranja: string | null;
  titular: { nombre: string; apellido: string | null } | null;
  listado: CampoFrente | null;
}

// Los tipos cuyo estado es una FECHA, con lo que depende del TIPO: su nombre (la etiqueta cuando no
// hay fecha que mostrar), qué se lee sin fecha, y qué se lee usado. `VÁLIDO HASTA` y `VENCIÓ EL` son
// comunes y no están acá.
//
// Tabla por tipo y no `if` (spec 2026-09-17, "El contrato de `frentePase`"): un tipo con vigencia
// nuevo tiene que agregarse acá o sale SIN estado — nunca hereda "MEMBRESÍA". La prueba que recorre
// TIPOS lo exige.
//
// `descuento` NO está aunque tampoco tenga contador: su estado es un porcentaje que sale de
// niveles_descuento, un dato que el pase no recibe. Mientras no lo reciba, no lleva estado.
interface Vigencia {
  nombre: string;
  sinFecha: string;
  // null = el tipo no se "usa": `usadoEn` se ignora (la membresía, igual que en describirSaldo).
  usado: string | null;
}

const VIGENCIA_POR_TIPO: Record<string, Vigencia> = {
  membresia: { nombre: 'MEMBRESÍA', sinFecha: 'Sin activar', usado: null },
  cupon: { nombre: 'CUPÓN', sinFecha: 'Disponible', usado: 'Usado' },
};

// El estado de un tipo con fecha. El orden de las ramas ES la regla:
//   1. usado — GANA aunque tenga fecha, vigente o no (como en describirSaldo): un cupón canjeado no
//      puede decirle al cajero "VÁLIDO HASTA".
//   2. sin fecha — el nombre del tipo y su frase.
//   3. con fecha — `sigueVigente`, el MISMO de todo el sistema: el último día todavía vale.
// La fecha SIEMPRE corta: la frase larga de describirSaldo no entra al lado del logo.
function estadoVigencia(
  vigencia: Vigencia,
  vigenciaHasta: string | null,
  usadoEn: string | null,
  hoyIso: string,
): CampoFrente {
  if (vigencia.usado !== null && usadoEn) {
    return { etiqueta: vigencia.nombre, valor: vigencia.usado, numero: null };
  }
  if (!vigenciaHasta) {
    return { etiqueta: vigencia.nombre, valor: vigencia.sinFecha, numero: null };
  }
  return {
    etiqueta: sigueVigente(vigenciaHasta, hoyIso) ? 'VÁLIDO HASTA' : 'VENCIÓ EL',
    valor: formatearFechaCorta(vigenciaHasta),
    numero: null,
  };
}

// '' y '   ' valen lo mismo que null: el pase sale sin el campo en vez de con un campo vacío.
function recortado(texto: string | null): string | null {
  return (texto ?? '').trim() || null;
}

// El nombre del pase, solo sobre la banda lisa (decisión 3 del spec). La columna tiene un CHECK que
// impide el blanco, pero el pase lee filas que pueden venir de otra ruta.
function sobreFranjaDe(franja: Franja, nombrePase: string | null): string | null {
  return franja === 'banda' ? recortado(nombrePase) : null;
}

// Sin nombre no hay titular, aunque haya apellido: un APELLIDO solo a la derecha no nombra a nadie.
function titularDe(
  nombreCliente: string | null,
  apellidoCliente: string | null,
): FrentePase['titular'] {
  const nombre = recortado(nombreCliente);
  if (nombre === null) return null;
  return { nombre, apellido: recortado(apellidoCliente) };
}

export function frentePase(d: {
  tipoTarjeta: string;
  puntos: number;
  selloMeta: number | null;
  // Qué hay DE VERDAD en la franja (ver `Franja`). Cada consumidor lo calcula con lo que realmente
  // llegó al pase: Apple con `strips !== null`, Google con `heroImageUrl`, la vista previa con la
  // franja cargada. Decide solo `sobreFranja`; el estado y el listado no dependen de la franja.
  franja: Franja;
  // `tarjetas.vigencia_hasta` (AAAA-MM-DD) y `tarjetas.usado_en`: el estado de un cupón o una
  // membresía es una FECHA, no un número. null en la vista previa del editor, donde no hay ninguna
  // tarjeta emitida — ahí sale "Sin activar" / "Disponible" sin mirar el reloj.
  vigenciaHasta: string | null;
  usadoEn: string | null;
  // `programas_tarjeta.nombre_pase`. Solo se escribe sobre la banda lisa.
  nombrePase: string | null;
  // `clientes.nombre` y `clientes.apellido` (0036). null en las réplicas chicas del registro y del
  // admin, que solo muestran el estado. Un cliente anterior a la 0036 llega sin apellido.
  nombreCliente: string | null;
  apellidoCliente: string | null;
  // El "hoy" del COMERCIO (hoyEnZona(comercio.zona_horaria)), por argumento y no con un new Date()
  // adentro: el mismo motivo que describirSaldo —probar el borde del vencimiento sin congelar el
  // reloj— y además esta función corre también dentro de un componente 'use client', donde un reloj
  // propio daría mismatch de hidratación.
  hoyIso: string;
}): FrentePase {
  const sobreFranja = sobreFranjaDe(d.franja, d.nombrePase);
  const titular = titularDe(d.nombreCliente, d.apellidoCliente);

  // Cupón y membresía: el estado es la fecha corta; el listado, la frase de describirSaldo ("Activa
  // hasta el 12 de octubre de 2026", "Ya usado"), la MISMA que usan el panel, el escáner y el portal.
  const vigencia = VIGENCIA_POR_TIPO[tipoOPuntos(d.tipoTarjeta).valor];
  if (vigencia) {
    return {
      estado: estadoVigencia(vigencia, d.vigenciaHasta, d.usadoEn, d.hoyIso),
      sobreFranja,
      titular,
      listado: {
        etiqueta: vigencia.nombre,
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
      },
    };
  }

  // contadorPase decide etiqueta y formato SEGÚN EL TIPO ("SELLOS 7 de 10", "SALDO $50.00", "PUNTOS"
  // con el número pelado), y devuelve null para los que no tienen contador: ahí el pase no lleva
  // estado, en vez de un "PUNTOS 0" que no dice nada.
  const contador = contadorPase(d.tipoTarjeta, d.puntos, d.selloMeta);
  const estado = contador
    ? { etiqueta: contador.etiqueta, valor: contador.valor, numero: contador.numero }
    : null;

  // Los sellos con meta se listan CON la palabra: en la lista de Google no hay grilla que diga qué
  // se cuenta. No depende de la franja (nunca dependió de la grilla).
  if (d.tipoTarjeta === 'sellos' && d.selloMeta != null && d.selloMeta > 0) {
    return {
      estado,
      sobreFranja,
      titular,
      listado: { etiqueta: 'SELLOS', valor: `${d.puntos} de ${d.selloMeta} sellos`, numero: null },
    };
  }

  return { estado, sobreFranja, titular, listado: estado };
}
