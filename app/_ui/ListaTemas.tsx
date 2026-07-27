'use client';

import { useSyncExternalStore } from 'react';
import {
  ETIQUETAS_TEMA,
  TEMAS,
  aplicarTema,
  leerTema,
  leerTemaServidor,
  suscribirTema,
} from '@/lib/tema';

// Las tres opciones de tema, SIN cromo alrededor: quien la use decide dónde va (adentro del menú de
// más opciones en /comercio, adentro de su propia hoja en /admin). Vive en app/_ui/ porque la usan
// dos árboles de rutas distintos — el guion bajo hace que Next NO la tome como ruta.
//
// Es el ÚNICO lugar donde se decide qué tema está elegido y qué pasa al elegir otro. Si mañana hace
// falta el selector en una tercera pantalla, se importa esto; no se copia la lógica.
export default function ListaTemas() {
  // El tema real es el atributo data-tema del <html> (lo fijó el script del <head> antes del primer
  // pintado). useSyncExternalStore lo lee sin setState-en-effect y sin desajuste de hidratación: en
  // el servidor devuelve el tema por defecto, que es con el que se sirvió el HTML.
  const tema = useSyncExternalStore(suscribirTema, leerTema, leerTemaServidor);

  return (
    <div className="menu-temas">
      {TEMAS.map((t) => (
        <button
          key={t}
          type="button"
          className={`sheet-fila menu-tema${t === tema ? ' sheet-fila-activa' : ''}`}
          aria-pressed={t === tema}
          // A propósito NO cierra nada: el contenedor se repinta con el tema recién elegido y así
          // se pueden probar los tres seguidos sin volver a abrir el menú tres veces.
          onClick={() => aplicarTema(t)}
        >
          <span className="icono" aria-hidden="true">{ETIQUETAS_TEMA[t].icono}</span>
          <span>
            <span style={{ display: 'block', fontWeight: 600 }}>{ETIQUETAS_TEMA[t].nombre}</span>
            <span className="admin-fila-slug">{ETIQUETAS_TEMA[t].ayuda}</span>
          </span>
          {t === tema && (
            <span className="icono icono-lleno menu-tick" aria-hidden="true">check</span>
          )}
        </button>
      ))}
    </div>
  );
}
