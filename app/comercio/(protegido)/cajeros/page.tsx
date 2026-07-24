import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarCajeros } from '@/lib/comercio/cajeros';
import { listarSucursales } from '@/lib/comercio/sucursales';
import FormularioCajero from './FormularioCajero';
import BotonBajaCajero from './BotonBajaCajero';

export const dynamic = 'force-dynamic';

export default async function PaginaCajeros() {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const cajeros = await listarCajeros(supabase, comercioId);
  // Solo sucursales ACTIVAS se pueden elegir al dar de alta: no atar un cajero a una apagada.
  // null = error de BD (distinto de [] = no hay sucursales): ante un fallo transitorio no queremos
  // decirle "agregá una sucursal" a un dueño que sí tiene, y ocultarle el alta de cajeros.
  const sucursales = await listarSucursales(supabase, comercioId);
  const errorSucursales = sucursales === null;
  const sucursalesActivas = (sucursales ?? []).filter((s) => s.activa);

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Cajeros</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <div className="reveal d2">
        {errorSucursales ? (
          <p className="admin-error" role="alert">No se pudieron cargar las sucursales. Recargá la página.</p>
        ) : sucursalesActivas.length === 0 ? (
          <p className="admin-vacio">
            Primero agregá una sucursal activa: cada cajero atiende en una.{' '}
            <Link className="admin-fila-slug" href="/comercio/sucursales">Ir a Sucursales →</Link>
          </p>
        ) : (
          <FormularioCajero sucursales={sucursalesActivas} />
        )}
      </div>

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {cajeros === null ? (
          <p className="admin-error" role="alert">No se pudieron cargar los cajeros. Recargá la página.</p>
        ) : cajeros.length === 0 ? (
          <p className="admin-vacio">Todavía no hay cajeros. Agregá el primero.</p>
        ) : (
          cajeros.map((c) => (
            <div key={c.id} className="admin-fila">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="icono-circulo acento" aria-hidden="true">
                  <span className="icono">badge</span>
                </span>
                <div>
                  <div className="admin-fila-nombre">{c.email}</div>
                  <div className="admin-fila-slug">{c.sucursalNombre ?? 'Sin sucursal'}</div>
                </div>
              </div>
              <BotonBajaCajero id={c.id} email={c.email} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
