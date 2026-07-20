import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_REGLA } from '@/lib/comercio/reglas';
import FormularioRegla from './FormularioRegla';
import BotonEliminarRegla from './BotonEliminarRegla';

export const dynamic = 'force-dynamic';

export default async function PaginaReglas() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: reglas, error } = await supabase
    .from('reglas_puntos')
    .select('id, tipo, valor')
    .eq('comercio_id', comercioId)
    .order('activa_desde', { ascending: false });

  if (error) console.error('[comercio] falló la consulta de reglas:', error);

  const etiquetaTipo = (tipo: string) => TIPOS_REGLA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Reglas del programa</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <div className="reveal d2">
        <FormularioRegla />
      </div>

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar las reglas. Recarga la página.</p>
        ) : !reglas || reglas.length === 0 ? (
          <p className="admin-vacio">Todavía no hay reglas. Agrega la primera.</p>
        ) : (
          reglas.map((r) => (
            <div key={r.id} className="admin-fila">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="icono-circulo menta" aria-hidden="true">
                  <span className="icono">{r.tipo === 'por_monto' ? 'payments' : 'storefront'}</span>
                </span>
                <div>
                  <div className="admin-fila-nombre">{etiquetaTipo(r.tipo)}</div>
                  <div className="admin-fila-slug">
                    Valor: <span className="dato-mono">{r.valor}</span>
                  </div>
                </div>
              </div>
              <BotonEliminarRegla id={r.id} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
