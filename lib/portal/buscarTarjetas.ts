import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { normalizarTelefono } from '../clientes/normalizarTelefono';

export interface RecompensaPortal {
  nombre: string;
  descripcion: string | null;
  costoPuntos: number;
}

export interface TarjetaPortal {
  tarjetaId: string;
  comercioNombre: string;
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  tipoTarjeta: string;
  puntosActuales: number;
  selloMeta: number | null;
  saldoTexto: string;
  recompensas: RecompensaPortal[];
}

export interface ResultadoConsulta {
  encontrado: boolean;
  nombreCliente: string | null;
  tarjetas: TarjetaPortal[];
}

// El saldo se muestra como TEXTO en un solo lugar (spec §2, y §4.2 de la Fase 3: sin grilla
// visual). Sellos: "N de M sellos" (o "N sellos" si el comercio no fijó meta). Puntos y cualquier
// otro tipo: "N punto(s)".
export function formatearSaldo(tipoTarjeta: string, puntos: number, selloMeta: number | null): string {
  if (tipoTarjeta === 'sellos') {
    return selloMeta != null ? `${puntos} de ${selloMeta} sellos` : `${puntos} sellos`;
  }
  return `${puntos} ${puntos === 1 ? 'punto' : 'puntos'}`;
}

// Busca al cliente por teléfono y arma sus tarjetas con el comercio (nombre, colores, tipo, saldo)
// y las recompensas ACTIVAS de cada comercio. Solo lectura. Usa createServiceClient() (lo pasa el
// caller): clientes no cuelga de RLS y tarjetas/recompensas son deny-all salvo service_role.
export async function buscarTarjetasPorTelefono(
  supabase: SupabaseClient<Database>,
  telefono: string,
): Promise<ResultadoConsulta> {
  // Corregido tras revisión de plan: `clientes.telefono` SIEMPRE se guarda normalizado
  // (normalizarTelefono.ts: "7777-1234"/"77771234" -> "+50377771234", ver app/api/registro/
  // route.ts). Un .trim() a secas comparaba el valor CRUDO contra la columna CANÓNICA — un
  // cliente real tecleando su número tal como lo escribió jamás habría encontrado su tarjeta.
  // Sin este fix, la función entera no serviría para nada con datos reales aunque todas las
  // pruebas dieran verde (si insertan y consultan con el mismo string crudo, nunca lo detectan).
  let limpio: string;
  try {
    limpio = normalizarTelefono(telefono);
  } catch {
    // Formato irreconocible (ni +503 válido ni 8 dígitos locales): no es un error de
    // infraestructura, es que no hay tarjeta que buscar con eso.
    return { encontrado: false, nombreCliente: null, tarjetas: [] };
  }

  const { data: cliente, error: errorCliente } = await supabase
    .from('clientes')
    .select('id, nombre')
    .eq('telefono', limpio)
    .maybeSingle();

  if (errorCliente) {
    // maybeSingle() devuelve error:null cuando no hay filas: un error aquí es infraestructura.
    console.error('[portal] falló la consulta de cliente:', errorCliente);
    return { encontrado: false, nombreCliente: null, tarjetas: [] };
  }
  if (!cliente) return { encontrado: false, nombreCliente: null, tarjetas: [] };

  // Embed a-uno tarjetas -> comercios (FK tarjetas_comercio_id_fkey, ya en types.ts). Lee
  // tipo_tarjeta y sello_meta, que agrega la migración 0005 de la Fase 3 (prerrequisito).
  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    .select('id, puntos_actuales, comercios(id, nombre, color_fondo, color_texto, color_label, tipo_tarjeta, sello_meta)')
    .eq('cliente_id', cliente.id);

  if (errorTarjetas) {
    console.error('[portal] falló la consulta de tarjetas:', errorTarjetas);
    return { encontrado: true, nombreCliente: cliente.nombre, tarjetas: [] };
  }

  const filas = (tarjetas ?? []).filter((t) => t.comercios);
  const comercioIds = filas.map((t) => t.comercios!.id);

  // Recompensas activas de todos los comercios involucrados en UNA sola consulta (.in), luego se
  // agrupan por comercio en memoria. Se evita el embed inverso comercios(recompensas(...)), que
  // exigiría una Relationship que recompensas no declara en types.ts hoy.
  const recompensasPorComercio = new Map<string, RecompensaPortal[]>();
  if (comercioIds.length > 0) {
    const { data: recompensas, error: errorRecompensas } = await supabase
      .from('recompensas')
      .select('comercio_id, nombre, descripcion, costo_puntos')
      .in('comercio_id', comercioIds)
      .eq('activa', true)
      .order('costo_puntos');
    if (errorRecompensas) {
      console.error('[portal] falló la consulta de recompensas:', errorRecompensas);
    }
    for (const r of recompensas ?? []) {
      const lista = recompensasPorComercio.get(r.comercio_id) ?? [];
      lista.push({ nombre: r.nombre, descripcion: r.descripcion, costoPuntos: r.costo_puntos });
      recompensasPorComercio.set(r.comercio_id, lista);
    }
  }

  const resultado: TarjetaPortal[] = filas.map((t) => {
    const c = t.comercios!;
    return {
      tarjetaId: t.id,
      comercioNombre: c.nombre,
      colorFondo: c.color_fondo,
      colorTexto: c.color_texto,
      colorLabel: c.color_label,
      tipoTarjeta: c.tipo_tarjeta,
      puntosActuales: t.puntos_actuales,
      selloMeta: c.sello_meta,
      saldoTexto: formatearSaldo(c.tipo_tarjeta, t.puntos_actuales, c.sello_meta),
      recompensas: recompensasPorComercio.get(c.id) ?? [],
    };
  });

  return { encontrado: true, nombreCliente: cliente.nombre, tarjetas: resultado };
}
