'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { idPixelValido, rutaAdmitePixel } from '@/lib/marketing/pixelMeta';
import { dispararEvento, instalarPixel } from '@/lib/marketing/eventosMeta';

// Píxel de Meta para todo el sitio, menos las rutas de lib/marketing/pixelMeta.ts
// (PREFIJOS_SIN_PIXEL: registro y portal del cliente final, panel del dueño y panel de FM).
//
// Va en el layout raíz porque es el único lugar que cubre todas las páginas, y decide por la ruta
// del lado del cliente. No se puede decidir en el servidor sin volver dinámico el sitio entero (el
// layout no conoce la ruta), y un <script> en el HTML con un `if` adentro dejaría el código del
// píxel escrito en la página de registro del cliente aunque no corriera. Así, en una ruta excluida
// no se instala nada: ni el script ni la cola.
//
// ID en NEXT_PUBLIC_META_PIXEL_ID. Next la escribe en el bundle AL COMPILAR: cambiarla en Vercel
// pide un redeploy. Sin la variable (o con un valor que no es un ID), no hay píxel.
const ID_PIXEL = idPixelValido(process.env.NEXT_PUBLIC_META_PIXEL_ID);

export default function PixelMeta() {
  const ruta = usePathname();
  // Última ruta que ya mandó su PageView. En desarrollo React monta los efectos dos veces
  // (StrictMode): sin esto cada página contaría doble.
  const rutaMedida = useRef<string | null>(null);

  useEffect(() => {
    if (!ID_PIXEL) return;

    if (!rutaAdmitePixel(ruta)) {
      // Si se llegó navegando desde una página con píxel, el script ya está cargado y no se puede
      // descargar. `consent revoke` hace que el píxel no envíe nada mientras dure.
      //
      // OJO, medido en el navegador el 2026-09-13: `revoke` NO DESCARTA, RETIENE. Un `track`
      // llamado a mano en /mi-tarjeta no salió ahí, pero salió al volver a la portada (con la URL de
      // la portada). La defensa real no es esta línea: es que nuestro código jamás llama al píxel en
      // una ruta excluida (`dispararEvento` lo bloquea) y que la configuración automática, que
      // generaría eventos por su cuenta, está apagada (`instalarPixel`).
      window.fbq?.('consent', 'revoke');
      rutaMedida.current = null;
      return;
    }

    instalarPixel(ID_PIXEL);
    window.fbq?.('consent', 'grant');
    if (rutaMedida.current === ruta) return;
    rutaMedida.current = ruta;
    dispararEvento('PageView');
  }, [ruta]);

  return null;
}
