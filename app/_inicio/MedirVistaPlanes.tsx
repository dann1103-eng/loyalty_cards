'use client';

import { useEffect } from 'react';
import { dispararEvento } from '@/lib/marketing/eventosMeta';

// ViewContent de Meta cuando la sección de planes entra en pantalla. Una vez por carga de la
// página: volver a pasar por los precios en la misma visita no es una segunda vista.
//
// Mide la SECCIÓN por su id y no una tarjeta de plan: en el teléfono los tres planes van apilados y
// la sección mide varias pantallas, así que un umbral de "X% visible" podría no cumplirse nunca.
// En su lugar se usa el margen: cuenta cuando la sección llega al 60% superior de la pantalla, sea
// bajando con el dedo o saltando desde "Precios" en la cabecera.
export default function MedirVistaPlanes({ idSeccion }: { idSeccion: string }) {
  useEffect(() => {
    const seccion = document.getElementById(idSeccion);
    if (!seccion || typeof IntersectionObserver === 'undefined') return;

    const observador = new IntersectionObserver(
      (entradas) => {
        if (!entradas.some((entrada) => entrada.isIntersecting)) return;
        observador.disconnect();
        dispararEvento('ViewContent', { content_name: 'Planes', content_category: 'Precios' });
      },
      { rootMargin: '0px 0px -40% 0px' },
    );
    observador.observe(seccion);
    return () => observador.disconnect();
  }, [idSeccion]);

  return null;
}
