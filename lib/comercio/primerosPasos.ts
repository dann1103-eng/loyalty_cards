import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// EL TUTORIAL. Cuatro pasos que llevan a un negocio recién dado de alta desde "tengo una cuenta"
// hasta "mi primer cliente ya tiene su tarjeta".
//
// ══ POR QUÉ SE DERIVA DEL ESTADO Y NO SE GUARDA ══
// Lo obvio sería una columna `tutorial_paso` que cada pantalla actualiza. No se hizo, por dos
// razones que se pagan caro:
//   1. Una casilla guardada MIENTE en cuanto el dueño deshace algo. Si desactiva su único premio,
//      una columna seguiría diciendo "ya cargaste tu premio" y el tutorial lo felicitaría por algo
//      que ya no tiene.
//   2. Obligaría a acordarse de marcarla desde CADA pantalla que afecta el paso — el mismo tipo de
//      acoplamiento que hizo que `sello_meta` se leyera de una tabla y se escribiera en otra.
// Derivarlo de los datos reales no se puede desincronizar: la fuente es la misma que dibuja las
// pantallas.
//
// Los textos hablan en segunda persona y dicen QUÉ gana el dueño con cada paso, no qué le falta:
// una lista de pendientes sin motivo es una lista de reproches.

export interface PasoTutorial {
  clave: string;
  titulo: string;
  detalle: string;
  href: string;
  hecho: boolean;
}

// El catálogo, sin el estado. Se exporta para que la prueba verifique que el resultado tiene
// exactamente estos pasos y ninguno se cuele sin destino.
export const PASOS = [
  {
    clave: 'marca',
    titulo: 'Poné tu logo y tus colores',
    detalle: 'Así la tarjeta que guarda tu cliente se ve tuya, no nuestra.',
    href: '/comercio/branding',
  },
  {
    clave: 'reglas',
    titulo: 'Definí cómo se ganan los sellos',
    detalle: 'Por visita o por monto de compra. Lo cambiás cuando quieras.',
    href: '/comercio/reglas',
  },
  {
    clave: 'premio',
    titulo: 'Cargá tu primer premio',
    detalle: 'Es lo que tus clientes van a querer alcanzar.',
    href: '/comercio/recompensas',
  },
  {
    clave: 'cliente',
    titulo: 'Sumá tu primer cliente',
    detalle: 'Mostrale el código QR de tu local: él solo se registra en su celular.',
    href: '/comercio/programas',
  },
] as const;

// Todos los pasos con su estado real. Las cuatro consultas van en paralelo: esto corre en el panel,
// que es la primera pantalla que ve el dueño en cada visita.
//
// `head: true` + `count: 'exact'` no traen filas: solo hace falta saber si hay al menos una, y un
// comercio con miles de tarjetas no debería pagar el traslado de ninguna.
export async function primerosPasos(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<PasoTutorial[]> {
  const [marca, reglas, premios, clientes] = await Promise.all([
    supabase.from('comercios').select('logo_url').eq('id', comercioId).maybeSingle(),
    supabase
      .from('reglas_puntos')
      .select('id', { count: 'exact', head: true })
      .eq('comercio_id', comercioId),
    // SOLO las activas: desactivar el único premio devuelve el paso a pendiente, que es la verdad —
    // el cliente volvió a no tener nada que canjear.
    supabase
      .from('recompensas')
      .select('id', { count: 'exact', head: true })
      .eq('comercio_id', comercioId)
      .eq('activa', true),
    supabase
      .from('tarjetas')
      .select('id', { count: 'exact', head: true })
      .eq('comercio_id', comercioId),
  ]);

  // Ante un error de consulta el paso queda PENDIENTE, no hecho: mostrarle "ya está" a alguien que
  // no lo hizo lo deja sin saber qué le falta, y el panel se dibuja igual.
  const hechos: Record<string, boolean> = {
    marca: Boolean(marca.data?.logo_url),
    reglas: (reglas.count ?? 0) > 0,
    premio: (premios.count ?? 0) > 0,
    cliente: (clientes.count ?? 0) > 0,
  };

  return PASOS.map((paso) => ({ ...paso, hecho: hechos[paso.clave] ?? false }));
}
