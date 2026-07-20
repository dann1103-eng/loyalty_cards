import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Vista de FM de los clientes de UN comercio, con el QR de cada tarjeta (mismo qr_token que el
// barcode del pass). Espejo del directorio del dueño (/comercio/clientes), con gate de FM.
export default async function PaginaClientesComercio({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifyFmAdmin();
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('nombre, slug, tipo_tarjeta, sello_meta')
    .eq('id', id)
    .maybeSingle();

  if (!comercio) {
    return (
      <main className="admin-main">
        <p className="admin-error" role="alert">Ese comercio no existe.</p>
      </main>
    );
  }

  const { data: tarjetas, error } = await supabase
    .from('tarjetas')
    .select('id, qr_token, puntos_actuales, created_at, clientes(nombre, telefono)')
    .eq('comercio_id', id)
    .order('created_at', { ascending: false });

  if (error) console.error('[fm] falló la consulta de clientes del comercio:', error);

  const esSellos = comercio.tipo_tarjeta === 'sellos';
  const saldoTexto = (puntos: number) =>
    esSellos && comercio.sello_meta ? `${puntos} de ${comercio.sello_meta} sellos` : `${puntos} puntos`;

  const conQr = await Promise.all(
    (tarjetas ?? []).map(async (t) => ({
      ...t,
      qrDataUrl: await QRCode.toDataURL(t.qr_token, {
        width: 320,
        margin: 1,
        color: { dark: '#0e0e0e', light: '#ffffff' },
      }),
    })),
  );

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <div>
          <h1 className="title" style={{ margin: 0 }}>{comercio.nombre}</h1>
          <p className="lede" style={{ marginTop: 6, fontSize: '0.92rem' }}>
            <span className="dato-mono">{conQr.length}</span> clientes con tarjeta.
          </p>
        </div>
        <Link className="admin-fila-slug" href={`/admin/comercios/${id}/editar`}>← Volver al comercio</Link>
      </div>

      <div className="admin-lista reveal d2">
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar los clientes. Recarga la página.</p>
        ) : conQr.length === 0 ? (
          <p className="admin-vacio">Este comercio todavía no tiene clientes con tarjeta.</p>
        ) : (
          conQr.map((t) => (
            <details key={t.id} className="admin-fila" style={{ display: 'block' }}>
              <summary
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  cursor: 'pointer',
                  listStyle: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo neutro" aria-hidden="true">
                    <span className="icono">person</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{t.clientes?.nombre ?? 'Cliente'}</div>
                    <div className="admin-fila-slug dato-mono">{t.clientes?.telefono}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="admin-fila-nombre dato-mono" style={{ fontSize: '0.95rem' }}>
                    {saldoTexto(t.puntos_actuales)}
                  </div>
                  <div className="admin-fila-slug">ver QR</div>
                </div>
              </summary>
              <div style={{ paddingTop: 16, textAlign: 'center' }}>
                <div className="qr-tile" style={{ maxWidth: 200, margin: '0 auto' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL del servidor */}
                  <img src={t.qrDataUrl} alt={`QR de la tarjeta de ${t.clientes?.nombre ?? 'cliente'}`} />
                </div>
                <p className="qr-codigo">{t.qr_token}</p>
              </div>
            </details>
          ))
        )}
      </div>
    </main>
  );
}
