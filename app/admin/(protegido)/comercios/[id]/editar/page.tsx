import Link from 'next/link';
import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioComercio from '../../FormularioComercio';
import BotonEliminar from '../../BotonEliminar';
import { accionActualizarComercio, accionEliminarComercio } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarComercio({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifyFmAdmin();
  const { id } = await params;

  const supabase = createServiceClient();
  const { data: comercio, error } = await supabase
    .from('comercios')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error:null cuando no hay filas, así que un error aquí SIEMPRE es
    // infraestructura. Sin separarlo, un fallo de consulta caería en notFound() y le diría al
    // admin que el comercio NO EXISTE —mentira— justo después de que lo vio en la lista.
    console.error('[fm] falló la consulta del comercio a editar:', error);
    return (
      <main className="admin-main">
        <div className="admin-encabezado">
          <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
            Comercio
          </h1>
          <Link className="admin-fila-slug" href="/admin/comercios">
            ← Volver
          </Link>
        </div>
        <p className="admin-error" role="alert">
          No se pudo cargar este comercio. Revisa la conexión y recarga la página.
        </p>
      </main>
    );
  }

  if (!comercio) notFound();

  // QR de registro del comercio (la puerta de entrada de sus clientes) + cuentas de dueño:
  // lo que FM necesita a mano en una demo o al dar de alta un local.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  const urlRegistro = baseUrl ? `${baseUrl}/registro/${comercio.slug}` : null;
  const qrRegistro = urlRegistro
    ? await QRCode.toDataURL(urlRegistro, { width: 380, margin: 1, color: { dark: '#0e0e0e', light: '#ffffff' } })
    : null;
  const { data: duenos } = await supabase
    .from('usuarios_comercio')
    .select('email, rol')
    .eq('comercio_id', id)
    .order('rol');

  // bind() fija el id como primer argumento; la firma que ve useActionState sigue siendo
  // (estado, formData).
  const accion = accionActualizarComercio.bind(null, id);
  const eliminar = accionEliminarComercio.bind(null, id);

  // Las columnas de color son nullable en la BD (migración 0001: `color_fondo text`) pero
  // DatosComercio las declara string, así que Partial<DatosComercio> las vuelve
  // `string | undefined` y NO acepta null. Pasar `comercio` directo es un TS2322: hay que mapear.
  const inicial = {
    ...comercio,
    color_fondo: comercio.color_fondo ?? '',
    color_texto: comercio.color_texto ?? '',
    color_label: comercio.color_label ?? '',
  };

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>
          {comercio.nombre}
        </h1>
        <Link className="admin-fila-slug" href="/admin/comercios">
          ← Volver
        </Link>
      </div>
      <Link className="admin-fila reveal d2" href={`/admin/comercios/${id}/clientes`} style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="icono-circulo menta" aria-hidden="true">
            <span className="icono">group</span>
          </span>
          <div>
            <div className="admin-fila-nombre">Clientes y tarjetas</div>
            <div className="admin-fila-slug">Saldos y QR por cliente</div>
          </div>
        </div>
        <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
      </Link>

      {/* Acceso del comercio: el QR de registro (para crear tarjetas ahí mismo en una demo o en
          el local) y las cuentas que pueden entrar a su panel/escáner. */}
      <section className="panel reveal d2" style={{ marginTop: 0, marginBottom: 18 }}>
        <p className="titulo-seccion" style={{ marginBottom: 12 }}>Acceso del comercio</p>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {qrRegistro && (
            <div style={{ textAlign: 'center' }}>
              <div className="qr-tile" style={{ maxWidth: 170 }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL del servidor */}
                <img src={qrRegistro} alt={`QR de registro de ${comercio.nombre}`} />
              </div>
              <p className="qr-codigo">/registro/{comercio.slug}</p>
              <a
                className="btn-borde"
                style={{ marginTop: 8 }}
                href={qrRegistro}
                download={`qr-registro-${comercio.slug}.png`}
              >
                <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
                Descargar
              </a>
            </div>
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <p className="admin-fila-slug" style={{ marginBottom: 6 }}>
              Los clientes escanean el QR y crean su tarjeta. Cuentas con acceso al panel del comercio:
            </p>
            {(duenos ?? []).length === 0 ? (
              <p className="field-aviso">
                Sin cuentas todavía — creá una con <code className="dato-mono">npm run seed-comercio</code>.
              </p>
            ) : (
              (duenos ?? []).map((u) => (
                <p key={u.email} style={{ margin: '4px 0' }}>
                  <span className="dato-mono" style={{ fontSize: '0.85rem' }}>{u.email}</span>{' '}
                  <span className="pastilla pastilla-activo">{u.rol}</span>
                </p>
              ))
            )}
          </div>
        </div>
      </section>
      <FormularioComercio accion={accion} inicial={inicial} textoBoton="Guardar cambios" esEdicion />
      <BotonEliminar accion={eliminar} nombre={comercio.nombre} />
    </main>
  );
}
