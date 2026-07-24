import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Capa de datos de reportes/BI (Fase 10). Wrappers tipados sobre las funciones SQL de la migración
// 0010 (SECURITY INVOKER, execute solo para service_role). Cada función es `returns table(...)`, así
// que `.rpc()` devuelve `data` como ARRAY de filas.
//
// SCOPE: `comercioId` va SIEMPRE explícito y viene del gate de sesión (verifyComercioOwner), nunca de
// un campo del cliente — igual que el resto del proyecto, para que un dueño no pueda leer los reportes
// de otro comercio aunque conozca el id.
//
// CRITERIO ANTE ERROR (consistente en los cuatro): se registra con console.error y se devuelve `[]`.
// Una pantalla de reportes rota NO debe tumbar todo el panel: un arreglo vacío la deja renderizar su
// estado "sin datos" en vez de lanzar. La distinción "vacío real" vs "error" se maneja en la pantalla
// (que ya loguea) — acá no inventamos un canal de error extra que nadie consume.

// Los tipos de fila se DERIVAN de Database (fuente de verdad transcrita de la migración): si el shape
// de una función cambia en types.ts, estos tipos y las pantallas se enteran en compilación.
export type FilaReporteSucursal = Database['public']['Functions']['reporte_sucursales']['Returns'][number];
export type FilaTopCliente = Database['public']['Functions']['reporte_top_clientes']['Returns'][number];
export type FilaTendencia = Database['public']['Functions']['reporte_tendencia']['Returns'][number];
export type FilaFmComercio = Database['public']['Functions']['reporte_fm_comercios']['Returns'][number];

// Por sucursal del comercio: acreditaciones, puntos otorgados, canjes y clientes únicos. Incluye el
// bucket de actividad SIN sucursal (fila con sucursal_id null, p. ej. demos previos a la atribución).
export async function reporteSucursales(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<FilaReporteSucursal[]> {
  const { data, error } = await supabase.rpc('reporte_sucursales', { p_comercio_id: comercioId });
  if (error) {
    console.error('[reportes] falló reporte_sucursales:', error);
    return [];
  }
  return data ?? [];
}

// Top de clientes del comercio por cantidad de visitas (puntos como desempate). `limite` acota cuántas
// filas pide la función (la propia SQL lo satura con greatest(..., 0)).
export async function reporteTopClientes(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  limite: number,
): Promise<FilaTopCliente[]> {
  const { data, error } = await supabase.rpc('reporte_top_clientes', {
    p_comercio_id: comercioId,
    p_limite: limite,
  });
  if (error) {
    console.error('[reportes] falló reporte_top_clientes:', error);
    return [];
  }
  return data ?? [];
}

// Serie diaria (últimos `dias` días, hora de El Salvador) de acreditaciones y canjes. Incluye los días
// sin actividad en 0, así la pantalla puede dibujar la tendencia sin huecos.
export async function reporteTendencia(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  dias: number,
): Promise<FilaTendencia[]> {
  const { data, error } = await supabase.rpc('reporte_tendencia', {
    p_comercio_id: comercioId,
    p_dias: dias,
  });
  if (error) {
    console.error('[reportes] falló reporte_tendencia:', error);
    return [];
  }
  return data ?? [];
}

// Vista agregada cross-comercio para el panel FM: por comercio, con su cuenta (bucket "sin cuenta" para
// los que no tienen cuenta_id). NO toma comercioId — es una vista global, solo para el gate de FM.
export async function reporteFmComercios(
  supabase: SupabaseClient<Database>,
): Promise<FilaFmComercio[]> {
  const { data, error } = await supabase.rpc('reporte_fm_comercios');
  if (error) {
    console.error('[reportes] falló reporte_fm_comercios:', error);
    return [];
  }
  return data ?? [];
}
