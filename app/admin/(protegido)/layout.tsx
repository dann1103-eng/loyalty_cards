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
        <form action={cerrarSesion}>
          <button className="admin-salir" type="submit">
            Salir
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
