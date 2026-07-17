import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioComercio from '../../FormularioComercio';
import { accionActualizarComercio } from '../../actions';

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

  // bind() fija el id como primer argumento; la firma que ve useActionState sigue siendo
  // (estado, formData).
  const accion = accionActualizarComercio.bind(null, id);

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
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
          {comercio.nombre}
        </h1>
        <Link className="admin-fila-slug" href="/admin/comercios">
          ← Volver
        </Link>
      </div>
      <FormularioComercio accion={accion} inicial={inicial} textoBoton="Guardar cambios" esEdicion />
    </main>
  );
}
