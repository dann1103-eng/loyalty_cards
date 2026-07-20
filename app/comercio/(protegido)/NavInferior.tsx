'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Nav inferior móvil del panel del dueño (diseño C2/C3). En desktop se oculta por CSS.
const ENLACES = [
  { href: '/comercio/panel', icono: 'dashboard', etiqueta: 'Resumen' },
  { href: '/comercio/escanear', icono: 'qr_code_scanner', etiqueta: 'Escanear' },
  { href: '/comercio/branding', icono: 'palette', etiqueta: 'Marca' },
  { href: '/comercio/recompensas', icono: 'redeem', etiqueta: 'Premios' },
  { href: '/comercio/clientes', icono: 'group', etiqueta: 'Clientes' },
] as const;

export default function NavInferior() {
  const ruta = usePathname();

  return (
    <nav className="nav-inferior" aria-label="Secciones del panel">
      {ENLACES.map((e) => {
        const activo = ruta === e.href || ruta.startsWith(`${e.href}/`);
        return (
          <Link key={e.href} href={e.href} className={activo ? 'activo' : undefined}>
            <span className={`icono${activo ? ' icono-lleno' : ''}`} aria-hidden="true">
              {e.icono}
            </span>
            {e.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
