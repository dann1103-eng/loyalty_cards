import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import {
  accionesDisponibles,
  etiquetaConciliacion,
  listarPagos,
  necesitaAtencion,
  type PagoAdmin,
} from '@/lib/comercios/pagosAdmin';
import AccionesPago from './AccionesPago';

export const dynamic = 'force-dynamic';

// Cada pago que Wompi le informa a la app (webhook o retorno del cliente), con lo que el sistema hizo con
// él. Lo importante para FM es lo que NECESITA ATENCIÓN: un pago que entró y no se pudo aplicar solo
// (monto distinto, cobro anulado, doble pago, un error). Esos aparecen primero con su botón, y el número
// se ve en la nav.
//
// El cuerpo crudo trae nombre y correo de quien pagó: se muestra SOLO acá, plegado, para poder
// diagnosticar el formato real del webhook.

const fecha = (iso: string) =>
  new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/El_Salvador' }).format(
    new Date(iso),
  );

function claseConciliacion(p: PagoAdmin): string | null {
  if (p.conciliacion === 'aplicado') return 'pastilla-activo';
  if (necesitaAtencion(p)) return 'pastilla-inactivo';
  return null;
}

export default async function PaginaPagos({ searchParams }: { searchParams: Promise<{ atencion?: string }> }) {
  await verifyFmAdmin();
  const { atencion } = await searchParams;
  const soloAtencion = atencion === '1';

  const pagos = await listarPagos(createServiceClient(), { soloAtencion });

  return (
    <main className="admin-main" style={{ maxWidth: 820 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Pagos</h1>
        <Link className="admin-fila-slug" href="/admin/cuentas">← Cuentas</Link>
      </div>

      <div className="filtro-chips reveal d2" style={{ marginBottom: 16 }}>
        <Link className={`filtro-chip${!soloAtencion ? ' activo' : ''}`} href="/admin/pagos">
          Todos
        </Link>
        <Link className={`filtro-chip${soloAtencion ? ' activo' : ''}`} href="/admin/pagos?atencion=1">
          Necesitan atención
        </Link>
      </div>

      <section className="reveal d3">
        {/* `null` no es lista vacía: decir "no hay pagos" por un fallo de consulta haría que FM dejara de
            mirar un pago que sí entró. */}
        {pagos === null ? (
          <p className="admin-error" role="alert">No se pudieron cargar los pagos. Recargá la página.</p>
        ) : pagos.length === 0 ? (
          <p className="admin-vacio">
            {soloAtencion ? 'Ningún pago necesita atención.' : 'Todavía no cayó ningún pago.'}
          </p>
        ) : (
          <div className="admin-lista">
            {pagos.map((p) => {
              const clase = claseConciliacion(p);
              return (
                <div
                  key={p.id}
                  className="admin-fila"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div className="admin-fila-nombre dato-mono">${p.monto.toFixed(2)}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        className="pastilla"
                        style={p.esReal ? undefined : { color: 'var(--texto-2)', background: 'var(--superficie-0)' }}
                      >
                        {p.esReal ? 'Real' : 'Prueba'}
                      </span>
                      <span
                        className={`pastilla${clase ? ` ${clase}` : ''}`}
                        style={clase ? undefined : { color: 'var(--texto-2)', background: 'var(--superficie-0)' }}
                      >
                        {etiquetaConciliacion(p.conciliacion)}
                      </span>
                    </div>
                  </div>

                  <div className="admin-fila-slug">
                    {fecha(p.fecha ?? p.creadoEn)}
                    {' · '}
                    {p.cuentaId ? (
                      <Link href={`/admin/cuentas/${p.cuentaId}`}>{p.cuentaNombre ?? 'Cuenta'}</Link>
                    ) : (
                      'Sin cuenta'
                    )}
                    {' · '}
                    {p.fuente === 'webhook' ? 'Webhook' : p.fuente === 'redirect' ? 'Retorno del cliente' : 'A mano'}
                    {p.revisadoEn && ` · revisado ${fecha(p.revisadoEn)}`}
                  </div>
                  <div className="admin-fila-slug dato-mono" style={{ wordBreak: 'break-all' }}>
                    {p.idTransaccion}
                  </div>
                  {p.detalle && <div className="admin-fila-slug" style={{ fontStyle: 'italic' }}>{p.detalle}</div>}

                  <AccionesPago eventoId={p.id} acciones={accionesDisponibles(p)} />

                  <details style={{ marginTop: 6 }}>
                    <summary className="admin-fila-slug" style={{ cursor: 'pointer' }}>Cuerpo recibido</summary>
                    <pre
                      className="dato-mono"
                      style={{ fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '8px 0 0' }}
                    >
                      {JSON.stringify(p.payload, null, 2)}
                    </pre>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
