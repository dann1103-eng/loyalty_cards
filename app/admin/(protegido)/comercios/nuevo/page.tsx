import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import FormularioComercio from '../FormularioComercio';
import { accionCrearComercio } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaNuevoComercio() {
  await verifyFmAdmin();

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
      <FormularioComercio accion={accionCrearComercio} textoBoton="Crear comercio" />
    </main>
  );
}
