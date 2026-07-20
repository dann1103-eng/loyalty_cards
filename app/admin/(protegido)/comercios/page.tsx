import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PaginaComercios() {
  // Defensa en profundidad: el layout ya verificó, pero los layouts no se re-ejecutan en
  // navegación del lado del cliente. cache() hace que esto no cueste una consulta extra.
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const { data: comercios, error } = await supabase
    .from('comercios')
    .select('id, nombre, slug, licencia_estado, licencia_monto_mensual')
    .order('nombre');

  if (error) {
    // Sin esto, un fallo de consulta deja comercios en null y la página muestra "Todavía no hay
    // comercios" — una MENTIRA, y de las caras: le dice a FM que su cartera está vacía cuando lo
    // único que pasa es que la BD no responde. "Vacío" y "roto" tienen que verse distinto.
    console.error('[fm] falló la consulta de comercios:', error);
  }

  // Conteo de clientes con tarjeta por comercio (una sola consulta liviana; se agrupa acá).
  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    .select('comercio_id');
  if (errorTarjetas) console.error('[fm] falló el conteo de tarjetas:', errorTarjetas);
  const clientesPorComercio = new Map<string, number>();
  for (const t of tarjetas ?? []) {
    clientesPorComercio.set(t.comercio_id, (clientesPorComercio.get(t.comercio_id) ?? 0) + 1);
  }

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Comercios</h1>
        <Link className="btn-primary" style={{ width: 'auto', marginTop: 0 }} href="/admin/comercios/nuevo">
          <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">add</span>
          Nuevo comercio
        </Link>
      </div>

      {error ? (
        <p className="admin-error" role="alert">
          No se pudo cargar la lista de comercios. Revisa la conexión y recarga la página.
        </p>
      ) : !comercios || comercios.length === 0 ? (
        <p className="admin-vacio">Todavía no hay comercios. Crea el primero.</p>
      ) : (
        <div className="admin-lista reveal d2">
          {comercios.map((c) => (
            <Link key={c.id} className="admin-fila" href={`/admin/comercios/${c.id}/editar`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="icono-circulo acento" aria-hidden="true">
                  <span className="icono">storefront</span>
                </span>
                <div>
                  <div className="admin-fila-nombre">{c.nombre}</div>
                  <div className="admin-fila-slug">
                    /{c.slug} · <span className="dato-mono">{clientesPorComercio.get(c.id) ?? 0}</span> clientes
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {c.licencia_monto_mensual != null && (
                  <span className="admin-fila-slug dato-mono">${c.licencia_monto_mensual}/mes</span>
                )}
                <span
                  className={`pastilla ${
                    c.licencia_estado === 'activo' ? 'pastilla-activo' : 'pastilla-inactivo'
                  }`}
                >
                  {c.licencia_estado}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
