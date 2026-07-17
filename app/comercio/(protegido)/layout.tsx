import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { cerrarSesionComercio } from '../actions';

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo.
  const { nombre } = await verifyComercioOwner();

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link href="/comercio/panel" className="admin-marca">{nombre}</Link>
        <form action={cerrarSesionComercio}>
          <button className="admin-salir" type="submit">Salir</button>
        </form>
      </header>
      {children}
    </div>
  );
}
