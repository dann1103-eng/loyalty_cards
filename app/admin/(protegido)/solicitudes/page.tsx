import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSolicitudes, etiquetaDePlan } from '@/lib/comercios/planCuenta';
import BotonesResolucion from './BotonesResolucion';

export const dynamic = 'force-dynamic';

// Bandeja de solicitudes de cambio de plan (migración 0017). El dueño pide desde /comercio/plan y
// acá se aprueba o se rechaza.
//
// Aprobar aplica el plan del catálogo (monto y límite sugeridos) sobre la cuenta. FM puede ajustar
// esos valores después desde la ficha de la cuenta — el límite siempre fue un default negociable.

export default async function PaginaSolicitudes() {
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const [pendientes, historial] = await Promise.all([
    listarSolicitudes(supabase, true),
    listarSolicitudes(supabase, false),
  ]);

  const resueltas = (historial ?? []).filter((s) => s.estado !== 'pendiente');

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  return (
    <main className="admin-main" style={{ maxWidth: 760 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Solicitudes de plan</h1>
        <Link className="admin-fila-slug" href="/admin/cuentas">← Cuentas</Link>
      </div>

      <section className="reveal d2">
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>
          Pendientes {pendientes && pendientes.length > 0 && `(${pendientes.length})`}
        </p>

        {/* `null` no es lista vacía: mostrar "no hay solicitudes" por un fallo de consulta haría que
            FM dejara a un cliente esperando sin enterarse. */}
        {pendientes === null ? (
          <p className="admin-error" role="alert">
            No se pudieron cargar las solicitudes. Recargá la página.
          </p>
        ) : pendientes.length === 0 ? (
          <p className="admin-vacio">No hay solicitudes pendientes.</p>
        ) : (
          <div className="admin-lista">
            {pendientes.map((s) => (
              <div
                key={s.id}
                className="admin-fila"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
              >
                <div className="admin-fila-nombre">{s.cuentaNombre ?? 'Cuenta sin nombre'}</div>
                <div className="admin-fila-slug">
                  {etiquetaDePlan(s.planActual)} → <strong style={{ color: 'var(--acento)' }}>{etiquetaDePlan(s.planSolicitado)}</strong>
                  {' · '}
                  {fecha(s.creadaEn)}
                </div>
                {s.motivo && (
                  <div className="admin-fila-slug" style={{ fontStyle: 'italic' }}>“{s.motivo}”</div>
                )}
                <BotonesResolucion solicitudId={s.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {resueltas.length > 0 && (
        <section className="reveal d3" style={{ marginTop: 26 }}>
          <p className="titulo-seccion" style={{ marginBottom: 10 }}>Resueltas</p>
          <div className="admin-lista">
            {resueltas.map((s) => (
              <div key={s.id} className="admin-fila" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="admin-fila-nombre">{s.cuentaNombre ?? 'Cuenta sin nombre'}</div>
                  <div className="admin-fila-slug">
                    {etiquetaDePlan(s.planActual)} → {etiquetaDePlan(s.planSolicitado)}
                    {s.resueltaEn && ` · ${fecha(s.resueltaEn)}`}
                  </div>
                  {s.comentarioFm && (
                    <div className="admin-fila-slug" style={{ fontStyle: 'italic' }}>“{s.comentarioFm}”</div>
                  )}
                </div>
                <span className={`pastilla ${s.estado === 'aprobada' ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
                  {s.estado === 'aprobada' ? 'Aprobada' : 'Rechazada'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
