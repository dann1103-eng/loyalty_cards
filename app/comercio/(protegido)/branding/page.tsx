import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioBranding from './FormularioBranding';
import SubidaImagen from './SubidaImagen';

export const dynamic = 'force-dynamic';

export default async function PaginaBranding() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: c } = await supabase
    .from('comercios')
    .select('nombre, tipo_tarjeta, color_fondo, color_texto, color_label, sello_meta, logo_url, strip_url, hero_url, sello_icono_url')
    .eq('id', comercioId)
    .maybeSingle();

  if (!c) {
    return (
      <main className="admin-main">
        <p className="admin-error" role="alert">No se pudo cargar tu comercio. Recarga la página.</p>
      </main>
    );
  }

  const esSellos = c.tipo_tarjeta === 'sellos';

  const imagenes: [string, string, string | null][] = [
    ['logo', 'Logo', c.logo_url],
    ['strip', 'Franja (strip)', c.strip_url],
    ['hero', 'Imagen principal', c.hero_url],
  ];
  if (esSellos) imagenes.push(['sello_icono', 'Ícono del sello', c.sello_icono_url]);

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Branding</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <FormularioBranding
        nombreComercio={c.nombre}
        esSellos={esSellos}
        inicial={{
          color_fondo: c.color_fondo ?? 'rgb(35, 24, 18)',
          color_texto: c.color_texto ?? 'rgb(255, 255, 255)',
          color_label: c.color_label ?? 'rgb(255, 255, 255)',
          sello_meta: c.sello_meta != null ? String(c.sello_meta) : '',
        }}
      />

      <div className="admin-zona-peligro" style={{ borderTopStyle: 'solid' }}>
        <h2 className="admin-fila-nombre" style={{ marginBottom: 14 }}>Imágenes</h2>
        {imagenes.map(([campo, etiqueta, url]) => (
          <SubidaImagen key={campo} campo={campo} etiqueta={etiqueta} urlActual={url} />
        ))}
      </div>
    </main>
  );
}
