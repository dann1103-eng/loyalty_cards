import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas } from '@/lib/comercio/programas';
import { describirFila } from '@/lib/tarjetas/estadoTarjeta';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import { listarNiveles } from '@/lib/tarjetas/descuento';

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
    .select('nombre, slug, zona_horaria')
    .eq('id', id)
    .maybeSingle();

  if (!comercio) {
    return (
      <main className="admin-main">
        <p className="admin-error" role="alert">Ese comercio no existe.</p>
      </main>
    );
  }

  // El tipo y la meta salen del PROGRAMA de cada tarjeta (0024), no de las columnas legadas del
  // comercio: un comercio con dos programas tiene clientes de tipos distintos en esta misma lista, y
  // con las columnas viejas una gift card de $25.00 se leía "2500 puntos" también acá.
  const [programas, { data: tarjetas, error }] = await Promise.all([
    listarProgramas(supabase, id, { soloActivos: false }),
    supabase
      .from('tarjetas')
      .select(
        'id, qr_token, puntos_actuales, vigencia_hasta, usado_en, acumulado_centavos, created_at, programa_id, clientes(nombre, telefono)',
      )
      .eq('comercio_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (error) console.error('[fm] falló la consulta de clientes del comercio:', error);

  const programaPorId = new Map((programas ?? []).map((p) => [p.id, p]));
  const niveles = (programas ?? []).some((p) => p.tipoTarjeta === 'descuento')
    ? ((await listarNiveles(supabase, id)) ?? [])
    : [];
  const hoyIso = hoyEnZona(comercio.zona_horaria);

  const saldoTexto = (t: Parameters<typeof describirFila>[0] & { programa_id: string }) => {
    const p = programaPorId.get(t.programa_id);
    return describirFila(t, p?.tipoTarjeta ?? 'puntos', p?.selloMeta ?? null, niveles, hoyIso);
  };

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
                    {saldoTexto(t)}
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
