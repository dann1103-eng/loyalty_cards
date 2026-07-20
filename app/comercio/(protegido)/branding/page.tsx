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
    .select('nombre, tipo_tarjeta, color_fondo, color_texto, color_label, sello_meta, logo_url, strip_url, hero_url, sello_icono_url, difuminado_franja')
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

  // Cada etiqueta dice DÓNDE aparece la imagen en el pass — "Imagen principal" a secas no le
  // decía nada al dueño (confusión real vista en el piloto).
  const imagenes: [string, string, string | null][] = [
    ['logo', 'Logo (esquina superior del pass)', c.logo_url],
    ['hero', 'Foto de fondo de la franja', c.hero_url],
    ['strip', 'Franja personalizada (reemplaza la grilla de sellos)', c.strip_url],
  ];
  if (esSellos) imagenes.push(['sello_icono', 'Ícono de los sellos', c.sello_icono_url]);

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <div>
          <h1 className="title" style={{ margin: 0 }}>Editor de marca</h1>
          <p className="lede" style={{ marginTop: 6, fontSize: '0.92rem' }}>
            Personalizá la tarjeta que tus clientes llevan en su billetera.
          </p>
        </div>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <FormularioBranding
        nombreComercio={c.nombre}
        esSellos={esSellos}
        inicial={{
          color_fondo: c.color_fondo ?? 'rgb(19, 19, 21)',
          color_texto: c.color_texto ?? 'rgb(245, 245, 240)',
          color_label: c.color_label ?? 'rgb(255, 157, 66)',
          sello_meta: c.sello_meta != null ? String(c.sello_meta) : '',
          difuminado_franja: c.difuminado_franja,
        }}
        urls={{ logo: c.logo_url, hero: c.hero_url, selloIcono: c.sello_icono_url }}
        subidas={imagenes.map(([campo, etiqueta, url]) => (
          <SubidaImagen key={campo} campo={campo} etiqueta={etiqueta} urlActual={url} />
        ))}
      />
    </main>
  );
}
