import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarDifusiones, MAXIMO_DIFUSIONES_30_DIAS } from '@/lib/comercio/difusiones';
import { listarProgramas } from '@/lib/comercio/programas';
import AvisoComercioActivo from '../AvisoComercioActivo';
import FormularioDifusion from './FormularioDifusion';

export const dynamic = 'force-dynamic';

export default async function PaginaNotificaciones() {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  const [difusiones, programas] = await Promise.all([
    listarDifusiones(supabase, comercioId),
    listarProgramas(supabase, comercioId, { soloActivos: true }),
  ]);

  const hace30dias = new Date().getTime() - 30 * 24 * 60 * 60 * 1000;
  const usadasEnVentana = (difusiones ?? []).filter((d) => new Date(d.creadaEn).getTime() >= hace30dias).length;
  const puedeCrear = usadasEnVentana < MAXIMO_DIFUSIONES_30_DIAS;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Notificaciones</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>
      <p className="lede reveal d1" style={{ marginTop: 0 }}>
        Te quedan {Math.max(0, MAXIMO_DIFUSIONES_30_DIAS - usadasEnVentana)} de {MAXIMO_DIFUSIONES_30_DIAS} campañas en los últimos 30 días.
      </p>

      <AvisoComercioActivo />

      <div className="reveal d2" style={{ marginTop: 22 }}>
        <FormularioDifusion programas={(programas ?? []).map((p) => ({ id: p.id, nombre: p.nombre }))} puedeCrear={puedeCrear} />
      </div>

      {!difusiones ? (
        <p className="admin-error reveal d3" role="alert" style={{ marginTop: 22 }}>
          No se pudo cargar el historial. Recargá la página.
        </p>
      ) : difusiones.length > 0 && (
        <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
          {difusiones.map((d) => (
            <div key={d.id} className="admin-fila">
              <div>
                <div className="admin-fila-nombre">{d.mensaje}</div>
                <div className="admin-fila-slug">
                  {new Date(d.creadaEn).toLocaleDateString('es-SV')} · {d.destinatarios} tarjetas alcanzadas
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
