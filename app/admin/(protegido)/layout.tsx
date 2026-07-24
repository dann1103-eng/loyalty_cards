import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { cerrarSesion } from '../actions';

export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO es la única: cada página y cada Server Action repiten el chequeo,
  // porque los layouts no se re-renderizan en navegación del lado del cliente.
  await verifyFmAdmin();

  return (
    <div className="admin-shell" style={{ paddingBottom: 0 }}>
      <header className="admin-top">
        <span className="admin-marca">
          <span className="icono-circulo" aria-hidden="true" style={{ background: 'var(--acento-fuerte)', color: 'var(--sobre-acento)', width: 34, height: 34, minWidth: 34 }}>
            <span className="icono icono-lleno" style={{ fontSize: 18 }}>shield_person</span>
          </span>
          FM Lealtad · Interno
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Nav interna del panel FM. Reusa el estilo pastilla de .admin-salir para no depender de
              CSS nuevo (globals.css queda fuera del alcance de esta fase). */}
          <nav style={{ display: 'flex', gap: 8 }}>
            <Link className="admin-salir" style={{ textDecoration: 'none' }} href="/admin/comercios">
              Comercios
            </Link>
            <Link className="admin-salir" style={{ textDecoration: 'none' }} href="/admin/cuentas">
              Cuentas
            </Link>
          </nav>
          <form action={cerrarSesion}>
            <button className="admin-salir" type="submit">
              Salir
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
