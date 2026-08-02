import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { resolverDatosCartel } from '@/lib/comercio/cartel/resolverDatosCartel';
import EditorCartel from './EditorCartel';

export const dynamic = 'force-dynamic';

export default async function PaginaCartel({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: programaId } = await params;
  // El gate va FUERA de todo try/catch: redirect() funciona LANZANDO NEXT_REDIRECT.
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();

  // resolverDatosCartel YA verifica que programaId sea del comercio de la sesión (lee
  // programas_tarjeta con .eq('comercio_id', comercioId)) — null significa "no existe o no es tuyo",
  // y las dos se tratan igual: 404, sin distinguir cuál para no filtrar si un id ajeno existe.
  const resuelto = await resolverDatosCartel(supabase, comercioId, programaId);
  if (!resuelto) notFound();
  const { datos, programaActivo, marcaEfectiva, tipoTarjeta } = resuelto;

  // Qué colores tiene GUARDADOS este cartel: es lo único que dice si el dueño ya personalizó (los
  // colores de `datos` no sirven para eso — un override puede coincidir con la marca). Se lee acá y
  // no dentro de resolverDatosCartel porque es información de la PANTALLA (cómo arranca la casilla
  // y si mostrar el botón de quitar el logo), no del cartel que se dibuja.
  const { data: disenoGuardado } = await supabase
    .from('disenos_cartel')
    .select('color_fondo, color_texto, color_label, logo_url')
    .eq('programa_id', programaId)
    .maybeSingle();

  return (
    <main className="admin-main" style={{ maxWidth: 720 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Diseñar cartel</h1>
        <Link className="admin-fila-slug" href="/comercio/programas">← Volver</Link>
      </div>
      <p className="lede reveal d1" style={{ marginTop: 0 }}>
        El cartel para mesa (sticker) o mostrador que tus clientes escanean para sumarse a{' '}
        {datos.nombreComercio}.
      </p>

      {/* No bloqueante — spec §7: el dueño puede querer archivar/reimprimir el diseño de un programa
          que ya desactivó, así que la pantalla sigue siendo accesible. Solo se le avisa que el QR ya
          impreso con esa URL no registra clientes. */}
      {!programaActivo && (
        <p className="admin-vacio" role="status" style={{ marginBottom: 18 }}>
          Este programa está desactivado: el QR de este cartel ya no registra clientes nuevos. Podés
          seguir editando el diseño, pero no imprimás uno nuevo hasta reactivarlo.
        </p>
      )}

      <EditorCartel
        programaId={programaId}
        datosResueltos={datos}
        // La marca a la que vuelve el toggle sale de resolverDatosCartel, NO de una segunda consulta
        // a `comercios`: desde la migración 0027 un programa puede tener marca propia, y con los
        // colores del negocio el cartel de ese programa volvería a una marca que no es la suya.
        marcaEfectiva={marcaEfectiva}
        personalizadoInicial={
          disenoGuardado?.color_fondo != null ||
          disenoGuardado?.color_texto != null ||
          disenoGuardado?.color_label != null
        }
        tieneLogoPropio={disenoGuardado?.logo_url != null}
        tipoTarjeta={tipoTarjeta}
      />
    </main>
  );
}
