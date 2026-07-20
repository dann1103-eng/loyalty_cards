import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// El QR de cada cliente codifica EXACTAMENTE su qr_token — el mismo valor que lleva el barcode
// del pass en su billetera. Así, cuando exista el escáner del cajero (Fase 4), leer este QR
// impreso o leer el pass da idéntico resultado.
async function qrDeTarjeta(qrToken: string): Promise<string> {
  return QRCode.toDataURL(qrToken, {
    width: 320,
    margin: 1,
    color: { dark: '#0e0e0e', light: '#ffffff' },
  });
}

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { comercioId } = await verifyComercioOwner();
  const { q } = await searchParams;
  const busqueda = (q ?? '').trim();

  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('tipo_tarjeta, sello_meta')
    .eq('id', comercioId)
    .maybeSingle();
  const esSellos = comercio?.tipo_tarjeta === 'sellos';

  const { data: tarjetas, error } = await supabase
    .from('tarjetas')
    .select('id, qr_token, puntos_actuales, created_at, clientes(nombre, telefono)')
    .eq('comercio_id', comercioId)
    .order('created_at', { ascending: false });

  if (error) console.error('[comercio] falló la consulta de clientes:', error);

  // Filtro en servidor sobre el resultado (la lista del piloto es corta; paginar llegará después).
  const filtradas = (tarjetas ?? []).filter((t) => {
    if (!busqueda) return true;
    const cliente = t.clientes;
    const texto = `${cliente?.nombre ?? ''} ${cliente?.telefono ?? ''}`.toLowerCase();
    return texto.includes(busqueda.toLowerCase());
  });

  const conQr = await Promise.all(
    filtradas.map(async (t) => ({ ...t, qrDataUrl: await qrDeTarjeta(t.qr_token) })),
  );

  const saldoTexto = (puntos: number) =>
    esSellos && comercio?.sello_meta ? `${puntos} de ${comercio.sello_meta} sellos` : `${puntos} puntos`;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <div>
          <h1 className="title" style={{ margin: 0 }}>Clientes</h1>
          <p className="lede" style={{ marginTop: 6, fontSize: '0.92rem' }}>
            <span className="dato-mono">{tarjetas?.length ?? 0}</span> con tu tarjeta en su billetera.
          </p>
        </div>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      {/* Buscador (GET: sin JS, el server filtra) */}
      <form className="reveal d2" method="GET" style={{ marginBottom: 18 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="q">Buscar</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={busqueda}
            placeholder="Nombre o teléfono…"
          />
        </div>
      </form>

      <div className="admin-lista reveal d3">
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar los clientes. Recarga la página.</p>
        ) : conQr.length === 0 ? (
          <p className="admin-vacio">
            {busqueda
              ? `Nadie coincide con "${busqueda}".`
              : 'Todavía nadie tiene tu tarjeta. Mostrá el QR de registro de tu local para sumar al primero.'}
          </p>
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
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <Link className="btn-borde" href={`/comercio/escanear?token=${encodeURIComponent(t.qr_token)}`}>
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">add_circle</span>
                    Acreditar / Canjear
                  </Link>
                  <a
                    className="btn-borde"
                    href={t.qrDataUrl}
                    download={`qr-${(t.clientes?.nombre ?? 'cliente').toLowerCase().replace(/\s+/g, '-')}.png`}
                  >
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
                    Descargar
                  </a>
                </div>
              </div>
            </details>
          ))
        )}
      </div>

      <p className="nota reveal d4">
        El QR de cada cliente es el mismo que lleva su pass: cuando llegue el escáner del cajero,
        cualquiera de los dos suma sellos o puntos.
      </p>
    </main>
  );
}
