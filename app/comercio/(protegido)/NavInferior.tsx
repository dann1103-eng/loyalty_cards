'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { enlacesBarraPorRol, HREF_ESCANEAR } from '@/lib/comercio/navegacion';

// Nav inferior móvil. Reemplaza al carrusel deslizable de 9 secciones: entraban a la fuerza, había
// que deslizar para ver las últimas cuatro y nadie descubría que se podía. Ahora son 5 destinos
// FIJOS repartidos en una grilla (nunca desbordan, nunca hay que deslizar) y lo demás vive en el
// menú de más opciones del header. En desktop se oculta por CSS. Qué ve cada rol lo decide
// enlacesBarraPorRol (lib/comercio/navegacion.ts), que tiene sus propios tests.
export default function NavInferior({ rol }: { rol: string }) {
  const ruta = usePathname();
  const enlaces = enlacesBarraPorRol(rol);

  return (
    <nav className="nav-inferior" aria-label="Secciones del panel">
      {/* La grilla se declara con --columnas y no con repeat(5,…) fijo: el cajero ve 3 destinos y
          con 5 columnas quedarían amontonados a la izquierda con dos huecos. */}
      <div className="nav-fila" style={{ '--columnas': enlaces.length } as React.CSSProperties}>
        {enlaces.map((e) => {
          const activo = ruta === e.href || ruta.startsWith(`${e.href}/`);
          const destacado = e.href === HREF_ESCANEAR;
          return (
            <Link
              key={e.href}
              href={e.href}
              // El destacado NO depende de estar activo: Escanear se ve igual de grande y con el
              // acento esté donde esté el usuario — es el ancla visual de la barra, no un estado.
              className={[destacado && 'nav-destacado', activo && 'activo']
                .filter(Boolean)
                .join(' ') || undefined}
              aria-current={activo ? 'page' : undefined}
            >
              <span
                className={`icono${activo || destacado ? ' icono-lleno' : ''}`}
                aria-hidden="true"
              >
                {e.icono}
              </span>
              <span className="nav-etiqueta">{e.etiqueta}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
