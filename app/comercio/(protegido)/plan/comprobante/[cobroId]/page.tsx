import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { obtenerCobro } from '@/lib/comercios/cobros';
import { cuentaDelComercio } from '../../actions';

export const dynamic = 'force-dynamic';

// Comprobante de un cobro. NO es un documento fiscal y el propio papel lo dice.
//
// Esa advertencia no es un descargo legal decorativo: sin personería jurídica no hay DTE, y un
// papel que PAREZCA una factura sin serlo le crea un problema al comercio (se lo va a llevar a su
// contador creyendo que le sirve) en vez de resolvérselo. Cuando exista la entidad y N1co, esto se
// reemplaza por el documento real.

export default async function PaginaComprobante({
  params,
}: {
  params: Promise<{ cobroId: string }>;
}) {
  const { comercioId, nombre } = await verifyComercioOwner();
  const { cobroId } = await params;

  const cuentaId = await cuentaDelComercio(comercioId);
  const supabase = createServiceClient();
  // Scopeado por cuenta: conocer el id de un cobro ajeno no debe mostrar el comprobante de otro
  // cliente, que lleva su nombre y sus montos.
  const cobro = cuentaId ? await obtenerCobro(supabase, cuentaId, cobroId) : null;

  if (!cobro) {
    return (
      <main className="admin-main" style={{ maxWidth: 560 }}>
        <div className="admin-encabezado reveal d1">
          <h1 className="title" style={{ margin: 0 }}>Comprobante</h1>
          <Link className="admin-fila-slug" href="/comercio/plan">← Volver</Link>
        </div>
        <p className="admin-error" role="alert">Ese comprobante no existe en tu cuenta.</p>
      </main>
    );
  }

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat('es-SV', { dateStyle: 'long' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

  return (
    <main className="admin-main" style={{ maxWidth: 560 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Comprobante</h1>
        <Link className="admin-fila-slug" href="/comercio/plan">← Volver</Link>
      </div>

      <section className="panel reveal d2" style={{ marginTop: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <div>
            <p className="admin-fila-slug" style={{ margin: 0 }}>Cardly SV</p>
            <p className="admin-fila-nombre" style={{ fontSize: '1.1rem' }}>{nombre}</p>
          </div>
          <p className="dato-mono admin-fila-slug">N.º {cobro.numero}</p>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--linea)', margin: '18px 0' }} />

        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0 }}>
          <dt className="admin-fila-slug">Período</dt>
          <dd className="admin-fila-nombre" style={{ margin: 0, fontSize: '0.95rem' }}>
            {fecha(cobro.periodoDesde)} — {fecha(cobro.periodoHasta)}
          </dd>

          <dt className="admin-fila-slug">Estado</dt>
          <dd style={{ margin: 0 }}>
            <span className={`pastilla ${cobro.estado === 'pagado' ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
              {cobro.estado === 'pagado' ? 'Pagado' : cobro.estado === 'anulado' ? 'Anulado' : 'Pendiente'}
            </span>
          </dd>

          {cobro.pagadoEn && (
            <>
              <dt className="admin-fila-slug">Fecha de pago</dt>
              <dd className="admin-fila-nombre" style={{ margin: 0, fontSize: '0.95rem' }}>{fecha(cobro.pagadoEn)}</dd>
            </>
          )}

          {cobro.metodo && (
            <>
              <dt className="admin-fila-slug">Medio de pago</dt>
              <dd className="admin-fila-nombre" style={{ margin: 0, fontSize: '0.95rem' }}>{cobro.metodo}</dd>
            </>
          )}
        </dl>

        <hr style={{ border: 0, borderTop: '1px solid var(--linea)', margin: '18px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="titulo-seccion">Total</span>
          <span className="metric-valor dato-mono" style={{ fontSize: '1.6rem', color: 'var(--acento)' }}>
            ${cobro.monto.toFixed(2)}
          </span>
        </div>

        {cobro.nota && (
          <p className="admin-fila-slug" style={{ marginTop: 14, fontStyle: 'italic' }}>{cobro.nota}</p>
        )}

        {/* La advertencia va DENTRO del comprobante, no en la página alrededor: el dueño va a
            imprimir o capturar esto, y el contexto de la pantalla no viaja con el papel. */}
        <p className="nota" style={{ marginTop: 20, marginBottom: 0 }}>
          Este comprobante es para tu control interno. <strong>No tiene validez fiscal</strong> y no
          es un Documento Tributario Electrónico.
        </p>
      </section>
    </main>
  );
}
