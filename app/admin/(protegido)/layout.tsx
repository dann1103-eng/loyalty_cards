import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { cerrarSesion } from '../actions';

export default async function LayoutProtegido({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO es la única: cada página y cada Server Action repiten el chequeo,
  // porque los layouts no se re-renderizan en navegación del lado del cliente.
  await verifyFmAdmin();

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <span className="admin-marca">FM Lealtad</span>
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
