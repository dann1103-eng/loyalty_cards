import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioBranding from './FormularioBranding';
import SubidaImagen from './SubidaImagen';
import AvisoComercioActivo from '../AvisoComercioActivo';

export const dynamic = 'force-dynamic';

// `?nuevo=1` lo pone accionCrearComercioPropio al aterrizar acá tras el alta self-serve: sin ese
// aviso, el dueño llega al editor de marca de un comercio que acaba de crear sin saber POR QUÉ está
// en esta pantalla (el header ya cambió de comercio bajo sus pies).
export default async function PaginaBranding({
  searchParams,
}: {
  searchParams: Promise<{ nuevo?: string }>;
}) {
  const { comercioId } = await verifyComercioOwner();
  const { nuevo } = await searchParams;

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

      {/* El aviso de contexto se omite cuando el dueño acaba de llegar de crear el comercio: el
          banner de abajo ya le dice exactamente dónde está y por qué, y dos carteles seguidos
          diciendo lo mismo es ruido. */}
      {nuevo !== '1' && <AvisoComercioActivo />}

      {nuevo === '1' && (
        <p className="admin-vacio" role="status" style={{ marginBottom: 18 }}>
          Tu comercio nuevo ya está creado. Este es su editor de marca: configurá colores, logo e
          imágenes de la tarjeta{esSellos ? ' y la meta de sellos' : ''}.
        </p>
      )}

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
