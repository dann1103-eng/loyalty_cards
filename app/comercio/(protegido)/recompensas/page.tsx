import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_RECOMPENSA } from '@/lib/comercio/recompensas';
import FormularioRecompensa from './FormularioRecompensa';
import BotonDesactivarRecompensa from './BotonDesactivarRecompensa';

export const dynamic = 'force-dynamic';

export default async function PaginaRecompensas() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: recompensas, error } = await supabase
    .from('recompensas')
    .select('id, nombre, descripcion, costo_puntos, tipo')
    .eq('comercio_id', comercioId)
    .eq('activa', true) // las desactivadas siguen en la BD (soft-delete), pero no se listan
    .order('costo_puntos');

  if (error) console.error('[comercio] falló la consulta de recompensas:', error);

  const etiquetaTipo = (tipo: string) => TIPOS_RECOMPENSA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Recompensas</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <FormularioRecompensa />

      <div className="admin-lista" style={{ marginTop: 22 }}>
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar las recompensas. Recarga la página.</p>
        ) : !recompensas || recompensas.length === 0 ? (
          <p className="admin-vacio">Todavía no hay recompensas. Agrega la primera.</p>
        ) : (
          recompensas.map((r) => (
            <div key={r.id} className="admin-fila">
              <div>
                <div className="admin-fila-nombre">{r.nombre}</div>
                <div className="admin-fila-slug">
                  {r.costo_puntos} puntos · {etiquetaTipo(r.tipo)}
                  {r.descripcion ? ` · ${r.descripcion}` : ''}
                </div>
              </div>
              <BotonDesactivarRecompensa id={r.id} nombre={r.nombre} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
