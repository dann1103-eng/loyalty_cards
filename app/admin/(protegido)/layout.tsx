import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import SelectorTema from '@/app/_ui/SelectorTema';
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
          Cardly SV · Interno
        </span>
        {/* flexWrap acá y en la <nav>, y NO en la clase .admin-top: esa clase la comparte el header
            de /comercio, donde los tres elementos SÍ entran y hoy resuelven encogiéndose (la cuenta
            de anchos está en el comentario de .contexto-pastilla). Permitirles envolver allá
            cambiaría un layout ya calibrado; acá arregla uno que estaba roto.
            QUÉ ESTABA ROTO: a 360px este header pide como PISO ~104px de marca + ~314px de
            controles contra 320px disponibles — ya desbordaba ~98px antes de sumar nada, y con
            `overflow-x: hidden` en el <body> eso no se ve como desborde: se ve como que "Salir"
            está cortado. Sumar el botón de tema sin esto lo habría dejado fuera de pantalla justo
            en el teléfono, que es donde hace falta para salir de un tema que no se quiere. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
          {/* Nav interna del panel FM. Reusa el estilo pastilla de .admin-salir para no depender de
              CSS nuevo. */}
          <nav style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
            <Link className="admin-salir" style={{ textDecoration: 'none' }} href="/admin/comercios">
              Comercios
            </Link>
            <Link className="admin-salir" style={{ textDecoration: 'none' }} href="/admin/cuentas">
              Cuentas
            </Link>
            <Link className="admin-salir" style={{ textDecoration: 'none' }} href="/admin/reportes">
              Reportes
            </Link>
            {/* Bandeja de solicitudes de cambio de plan (0017). Si no está en la nav, las
                solicitudes de los dueños quedan esperando sin que nadie las vea. */}
            <Link className="admin-salir" style={{ textDecoration: 'none' }} href="/admin/solicitudes">
              Solicitudes
            </Link>
          </nav>
          {/* El tema se guarda en el <html>, o sea que es GLOBAL: quien elija claro o alto
              contraste desde el panel de comercio también deja así esta pantalla. Sin este botón,
              la única forma de volver sería irse a otra sección del producto a cambiar una
              preferencia para arreglar la consola en la que estaba. Va antes de "Salir" a propósito:
              lo último del header debe seguir siendo cerrar sesión, que es donde ya lo busca la
              mano. Es el MISMO componente que usa /comercio adentro de su menú — la lógica de qué
              tema está puesto y qué pasa al cambiarlo vive en un solo lugar (app/_ui/ListaTemas). */}
          <SelectorTema />
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
