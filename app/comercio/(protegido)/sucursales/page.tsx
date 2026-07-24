import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSucursales } from '@/lib/comercio/sucursales';
import FormularioSucursal from './FormularioSucursal';
import BotonEstadoSucursal from './BotonEstadoSucursal';

export const dynamic = 'force-dynamic';

export default async function PaginaSucursales() {
  const { comercioId } = await verifyComercioOwner();

  // listarSucursales trae activas e inactivas: el dueño necesita ver las apagadas para reactivarlas.
  const sucursales = await listarSucursales(createServiceClient(), comercioId);

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Sucursales</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <div className="reveal d2">
        <FormularioSucursal />
      </div>

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {sucursales.length === 0 ? (
          <p className="admin-vacio">Todavía no hay sucursales. Agregá la primera.</p>
        ) : (
          sucursales.map((s) => (
            <div
              key={s.id}
              className="admin-fila"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">store</span>
                  </span>
                  <div className="admin-fila-nombre">{s.nombre}</div>
                </div>
                <span className={`pastilla ${s.activa ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
                  {s.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <FormularioSucursal sucursal={{ id: s.id, nombre: s.nombre }} />
                </div>
                <BotonEstadoSucursal id={s.id} nombre={s.nombre} activa={s.activa} />
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
