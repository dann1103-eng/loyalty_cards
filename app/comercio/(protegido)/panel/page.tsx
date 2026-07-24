import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';

export const dynamic = 'force-dynamic';

const ATAJOS = [
  { href: '/comercio/escanear', icono: 'qr_code_scanner', tono: 'acento', titulo: 'Escanear tarjeta', sub: 'Sumá sellos/puntos o canjeá premios' },
  { href: '/comercio/branding', icono: 'palette', tono: 'acento', titulo: 'Identidad visual', sub: 'Colores, imágenes y sellos' },
  { href: '/comercio/reglas', icono: 'rule', tono: 'menta', titulo: 'Reglas del programa', sub: 'Cómo se ganan los puntos/sellos' },
  { href: '/comercio/recompensas', icono: 'redeem', tono: 'acento', titulo: 'Recompensas activas', sub: 'Catálogo de premios canjeables' },
  { href: '/comercio/sucursales', icono: 'store', tono: 'menta', titulo: 'Sucursales', sub: 'Locales que comparten tu tarjeta' },
  { href: '/comercio/cajeros', icono: 'badge', tono: 'acento', titulo: 'Cajeros', sub: 'Cuentas del personal por sucursal' },
  { href: '/comercio/clientes', icono: 'group', tono: 'neutro', titulo: 'Directorio de clientes', sub: 'Quiénes tienen tu tarjeta' },
] as const;

export default async function PaginaPanel() {
  // Defensa en profundidad: el layout ya verificó, pero no se re-ejecuta en navegación del
  // cliente. cache() hace que no cueste una consulta extra.
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('nombre, slug, tipo_tarjeta, sello_meta')
    .eq('id', comercioId)
    .maybeSingle();

  // Métricas reales: cuántos clientes tienen tarjeta y cuánto saldo circulante hay.
  const { data: tarjetas, count } = await supabase
    .from('tarjetas')
    .select('puntos_actuales', { count: 'exact' })
    .eq('comercio_id', comercioId);

  const totalClientes = count ?? 0;
  const totalSaldo = (tarjetas ?? []).reduce((suma, t) => suma + (t.puntos_actuales ?? 0), 0);

  const tipo = TIPOS_TARJETA.find((t) => t.valor === comercio?.tipo_tarjeta);
  const esSellos = comercio?.tipo_tarjeta === 'sellos';

  // QR de registro: los clientes lo escanean en el local y crean su tarjeta.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  const urlRegistro = comercio?.slug && baseUrl ? `${baseUrl}/registro/${comercio.slug}` : null;
  const qrRegistro = urlRegistro
    ? await QRCode.toDataURL(urlRegistro, { width: 380, margin: 1, color: { dark: '#0e0e0e', light: '#ffffff' } })
    : null;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <section className="reveal d1" style={{ marginBottom: 22 }}>
        <h1 className="title" style={{ fontSize: '1.7rem', margin: 0 }}>Resumen del local</h1>
        <p className="lede" style={{ marginTop: 6 }}>
          Así va tu programa de lealtad hoy.
        </p>
      </section>

      {/* Métricas apiladas (C2): texto oscuro SOLO aquí, sobre acento claro, por contraste. */}
      <section className="metric-pila reveal d2">
        <div className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Clientes con tarjeta</span>
            <span className="icono" aria-hidden="true">groups</span>
          </div>
          <div>
            <div className="metric-valor">{totalClientes}</div>
            <div className="metric-sub">registrados en tu comercio</div>
          </div>
        </div>
        <div className="metric-carta menta">
          <div className="metric-etiqueta">
            <span>{esSellos ? 'Sellos vigentes' : 'Puntos vigentes'}</span>
            <span className="icono" aria-hidden="true">auto_awesome</span>
          </div>
          <div>
            <div className="metric-valor">{totalSaldo}</div>
            <div className="metric-sub">{esSellos ? 'sellos sin canjear' : 'puntos sin canjear'}</div>
          </div>
        </div>
      </section>

      {/* Tu programa */}
      <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 className="admin-fila-nombre" style={{ fontSize: '1.15rem' }}>Tu programa</h2>
          <span className="pastilla pastilla-activo">Activo</span>
        </div>
        <p className="titulo-seccion" style={{ marginBottom: 4 }}>Tipo de tarjeta</p>
        <p style={{ fontWeight: 600 }}>{tipo?.etiqueta ?? comercio?.tipo_tarjeta}</p>
        {tipo && (
          <p style={{ color: 'var(--texto-2)', fontSize: '0.9rem', marginTop: 4 }}>
            {tipo.descripcion}
            {esSellos && comercio?.sello_meta ? ` Meta actual: ${comercio.sello_meta} sellos.` : ''}
          </p>
        )}
      </section>

      {/* QR de registro para el local */}
      {qrRegistro && (
        <section className="panel reveal d4" style={{ marginTop: 0, marginBottom: 22, textAlign: 'center' }}>
          <h2 className="admin-fila-nombre" style={{ fontSize: '1.1rem' }}>Mostralo en tu local</h2>
          <p style={{ color: 'var(--texto-2)', fontSize: '0.85rem', margin: '4px 0 16px' }}>
            Tus clientes lo escanean y crean su tarjeta al instante.
          </p>
          <div className="qr-tile" style={{ maxWidth: 230, margin: '0 auto' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
            <img src={qrRegistro} alt={`Código QR de registro de ${comercio?.nombre}`} />
          </div>
          <p className="qr-codigo">/registro/{comercio?.slug}</p>
          <a
            className="btn-borde"
            style={{ marginTop: 12 }}
            href={qrRegistro}
            download={`qr-registro-${comercio?.slug}.png`}
          >
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
            Descargar
          </a>
        </section>
      )}

      {/* Accesos rápidos */}
      <section className="reveal d5">
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Gestión rápida</p>
        <div className="panel-atajos" style={{ marginTop: 0 }}>
          {ATAJOS.map((a) => (
            <Link key={a.href} className="admin-fila" href={a.href}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className={`icono-circulo ${a.tono}`} aria-hidden="true">
                  <span className="icono">{a.icono}</span>
                </span>
                <div>
                  <div className="admin-fila-nombre">{a.titulo}</div>
                  <div className="admin-fila-slug">{a.sub}</div>
                </div>
              </div>
              <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
