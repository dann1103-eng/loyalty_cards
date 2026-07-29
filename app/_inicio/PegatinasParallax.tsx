'use client';

import { useEffect } from 'react';

// El parallax de los stickers: cada uno se corre un poco en vertical según por dónde va pasando la
// pantalla. La flotación (el sube-y-baja) es CSS puro y vive en `.pegatina`; esto es SOLO la deriva
// por scroll.
//
// ══ POR QUÉ EN JAVASCRIPT Y NO CON `animation-timeline: view()` ══
// La primera versión usaba animaciones CSS manejadas por scroll, que no necesitan JavaScript. Se
// descartó por dos razones concretas:
//   1. Firefox todavía no las soporta (ni detrás de flag por defecto), así que un tercio largo de
//      los visitantes no vería NADA del efecto.
//   2. Medido en el navegador, el `ViewTimeline` quedaba congelado: la animación existía y decía
//      `running`, pero su progreso se quedaba en 0.416 sin importar cuánto se scrolleara. Un efecto
//      que no se puede verificar es un efecto que no se puede prometer.
// Con rAF anda en todos lados y se puede medir, que es lo que importa para algo que el dueño va a
// mirar.
//
// ══ QUÉ PASA SI ESTE SCRIPT NO CORRE ══
// Nada malo: `--deriva-y` cae a su valor por defecto (0px) y los stickers quedan quietos en su
// sitio, con su giro y su flotación. La página pública tiene que funcionar sin JavaScript
// (PRODUCT.md) y lo sigue haciendo — esto es un adorno, no información.

// Cuánto se corre cada sticker, en píxeles, de un extremo al otro de su paso por la pantalla. Lo
// fija cada sticker con `--deriva` en su clase de posición; acá solo se lee.
const DERIVA_POR_DEFECTO = 34;

export default function PegatinasParallax() {
  useEffect(() => {
    // Quien pidió menos movimiento no recibe deriva. Se consulta una sola vez al montar y también
    // se escucha el cambio: alguien puede prender la preferencia con la página abierta.
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)');

    let pegatinas: HTMLElement[] = [];
    let pendiente = false;
    let vivo = true;

    const pintar = () => {
      pendiente = false;
      if (!vivo) return;
      const alto = window.innerHeight;
      for (const el of pegatinas) {
        const caja = el.getBoundingClientRect();
        // Progreso del sticker cruzando la pantalla: 0 cuando su centro entra por abajo, 1 cuando
        // sale por arriba. Se clampa para que un sticker fuera de cuadro no acumule valores enormes.
        const centro = caja.top + caja.height / 2;
        const progreso = Math.min(1, Math.max(0, 1 - centro / alto));
        // De +deriva a -deriva: al aparecer viene "abajo" de su sitio y se va corriendo hacia
        // arriba. Es lo que hace que se mueva a otra velocidad que el resto de la sección.
        const deriva = Number(
          getComputedStyle(el).getPropertyValue('--deriva').replace('px', '').trim(),
        ) || DERIVA_POR_DEFECTO;
        const y = (0.5 - progreso) * 2 * deriva;
        el.style.setProperty('--deriva-y', `${y.toFixed(1)}px`);
      }
    };

    // El listener de scroll NO pinta: solo agenda un cuadro. Sin esto, un scroll con rueda dispara
    // decenas de eventos por cuadro y se recalcula el layout en cada uno.
    const alScrollear = () => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(pintar);
    };

    const limpiar = () => {
      window.removeEventListener('scroll', alScrollear);
      window.removeEventListener('resize', alScrollear);
      for (const el of pegatinas) el.style.removeProperty('--deriva-y');
      pegatinas = [];
    };

    const arrancar = () => {
      limpiar();
      if (consulta.matches) return;
      pegatinas = Array.from(document.querySelectorAll<HTMLElement>('[data-pegatina]'));
      if (pegatinas.length === 0) return;
      window.addEventListener('scroll', alScrollear, { passive: true });
      window.addEventListener('resize', alScrollear, { passive: true });
      pintar();
    };

    arrancar();
    consulta.addEventListener('change', arrancar);

    return () => {
      vivo = false;
      consulta.removeEventListener('change', arrancar);
      limpiar();
    };
  }, []);

  // No dibuja nada: solo cablea el efecto sobre los stickers que ya renderizó el servidor. Así los
  // stickers siguen siendo HTML estático (buenos para el primer pintado y para un scraper) y este
  // componente solo les agrega el movimiento.
  return null;
}
