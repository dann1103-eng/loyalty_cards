import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import FormularioCuenta from '../FormularioCuenta';
import { accionCrearCuenta } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaNuevaCuenta() {
  await verifyFmAdmin();

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
          Nueva cuenta
        </h1>
        <Link className="admin-fila-slug" href="/admin/cuentas">
          ← Volver
        </Link>
      </div>
      <FormularioCuenta accion={accionCrearCuenta} textoBoton="Crear cuenta" />
    </main>
  );
}
