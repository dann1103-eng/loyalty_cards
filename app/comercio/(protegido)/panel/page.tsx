import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';
import { reporteSucursales } from '@/lib/reportes/reportes';

export const dynamic = 'force-dynamic';

const ATAJOS = [
  { href: '/comercio/escanear', icono: 'qr_code_scanner', tono: 'acento', titulo: 'Escanear tarjeta', sub: 'Sumá sellos/puntos o canjeá premios' },
  { href: '/comercio/branding', icono: 'palette', tono: 'acento', titulo: 'Identidad visual', sub: 'Colores, imágenes y sellos' },
  { href: '/comercio/reglas', icono: 'rule', tono: 'menta', titulo: 'Reglas del programa', sub: 'Cómo se ganan los puntos/sellos' },
  { href: '/comercio/programas', icono: 'style', tono: 'acento', titulo: 'Programas de tarjeta', sub: 'Tipo, configuración y QR de cada uno' },
  { href: '/comercio/notificaciones', icono: 'campaign', tono: 'menta', titulo: 'Notificaciones', sub: 'Campañas manuales y aviso de inactividad' },
  { href: '/comercio/recompensas', icono: 'redeem', tono: 'acento', titulo: 'Recompensas activas', sub: 'Catálogo de premios canjeables' },
  { href: '/comercio/sucursales', icono: 'store', tono: 'menta', titulo: 'Sucursales', sub: 'Locales que comparten tu tarjeta' },
  { href: '/comercio/cajeros', icono: 'badge', tono: 'acento', titulo: 'Cajeros', sub: 'Cuentas del personal por sucursal' },
  { href: '/comercio/clientes', icono: 'group', tono: 'neutro', titulo: 'Directorio de clientes', sub: 'Quiénes tienen tu tarjeta' },
  { href: '/comercio/reportes', icono: 'insights', tono: 'menta', titulo: 'Reportes', sub: 'Actividad por sucursal y clientes frecuentes' },
] as const;

// El cajero solo ve los atajos de SUS secciones (las demás lo rebotarían en su gate de página).
const RUTAS_ATAJOS_CAJERO = ['/comercio/escanear', '/comercio/clientes'];

export default async function PaginaPanel() {
  // Defensa en profundidad: el layout ya verificó, pero no se re-ejecuta en navegación del
  // cliente. cache() hace que no cueste una consulta extra.
  //
  // Gate COMPARTIDO (plan 2026-07-25 §4.8): el cajero también ve el Resumen — métricas y QR de
  // registro le sirven en caja. No hay Server Actions en esta página; las secciones owner-only
  // siguen detrás de verifyComercioOwner en sus propias páginas.
  const { comercioId, rol, sucursalActiva } = await verifyComercioAcceso();
  const esOwner = rol === 'owner';
  const atajos = esOwner ? ATAJOS : ATAJOS.filter((a) => RUTAS_ATAJOS_CAJERO.includes(a.href));

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

  // Contexto de sucursal (owner): actividad de ESA sucursal, con los reportes por sucursal ya
  // existentes. Sin contexto no se consulta nada extra. Una sucursal sin actividad todavía no
  // aparece en el reporte → carta en cero (no "sin carta": el contexto elegido siempre se ve).
  let actividadSucursal: { acreditaciones: number; canjes: number; clientes_unicos: number } | null = null;
  if (esOwner && sucursalActiva) {
    const filas = await reporteSucursales(supabase, comercioId);
    const fila = filas.find((f) => f.sucursal_id === sucursalActiva.id);
    actividadSucursal = {
      acreditaciones: fila?.acreditaciones ?? 0,
      canjes: fila?.canjes ?? 0,
      clientes_unicos: fila?.clientes_unicos ?? 0,
    };
  }

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

      {sucursalActiva && actividadSucursal && (
        <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>
              Actividad en {sucursalActiva.nombre}
            </h2>
            <span className="admin-fila-slug">contexto activo</span>
          </div>
          <div style={{ display: 'flex', gap: 28 }}>
            {[
              [actividadSucursal.clientes_unicos, 'Clientes'],
              [actividadSucursal.acreditaciones, 'Visitas'],
              [actividadSucursal.canjes, 'Premios'],
            ].map(([valor, etiqueta]) => (
              <div key={etiqueta}>
                <div className="dato-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}>
                  {valor}
                </div>
                <div className="admin-fila-slug" style={{ marginTop: 4 }}>{etiqueta}</div>
              </div>
            ))}
          </div>
        </section>
      )}

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
          {atajos.map((a) => (
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
