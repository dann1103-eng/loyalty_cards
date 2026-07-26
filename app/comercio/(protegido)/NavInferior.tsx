'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { enlacesPorRol } from '@/lib/comercio/navegacion';

// Nav inferior móvil (C2/C3). Con 9 secciones ya no entran todas en un viewport móvil: la barra es
// un carrusel deslizable (.nav-carril: overflow-x + snap; el CSS oculta la scrollbar y desvanece
// los bordes para insinuar que hay más íconos). En desktop se oculta por CSS. Qué ve cada rol lo
// decide enlacesPorRol (lib/comercio/navegacion.ts), que tiene sus propios tests.
export default function NavInferior({ rol }: { rol: string }) {
  const ruta = usePathname();
  const carrilRef = useRef<HTMLDivElement>(null);
  const enlaces = enlacesPorRol(rol);

  // La pestaña activa se trae a la vista al navegar (pudo quedar fuera del carrusel).
  useEffect(() => {
    carrilRef.current
      ?.querySelector('a.activo')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [ruta]);

  return (
    <nav className="nav-inferior" aria-label="Secciones del panel">
      <div className="nav-carril" ref={carrilRef}>
        {enlaces.map((e) => {
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
      </div>
    </nav>
  );
}
