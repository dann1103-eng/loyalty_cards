import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { cerrarSesionComercio } from '../actions';
import NavInferior from './NavInferior';

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo.
  const { nombre } = await verifyComercioOwner();

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link href="/comercio/panel" className="admin-marca">
          <span className="icono-circulo" aria-hidden="true">
            <span className="icono icono-lleno" style={{ fontSize: 18 }}>storefront</span>
          </span>
          {nombre}
        </Link>
        <form action={cerrarSesionComercio}>
          <button className="admin-salir" type="submit">Salir</button>
        </form>
      </header>
      {children}
      <NavInferior />
    </div>
  );
}
