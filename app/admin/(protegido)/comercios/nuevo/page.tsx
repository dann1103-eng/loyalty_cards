import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import FormularioComercio from '../FormularioComercio';
import { accionCrearComercio } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaNuevoComercio() {
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const { data: cuentas, error } = await supabase
    .from('cuentas_comercio')
    .select('id, nombre')
    .order('nombre');
  if (error) console.error('[fm] falló la consulta de cuentas para el formulario:', error);

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
          Nuevo comercio
        </h1>
        <Link className="admin-fila-slug" href="/admin/comercios">
          ← Volver
        </Link>
      </div>
      <FormularioComercio accion={accionCrearComercio} textoBoton="Crear comercio" cuentas={cuentas ?? []} />
    </main>
  );
}
