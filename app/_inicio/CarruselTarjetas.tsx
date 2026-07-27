'use client';

import { useRef, useState, type PointerEvent, type TouchEvent } from 'react';
import estilos from './inicio.module.css';
import { TarjetaModelo } from './TarjetaModelo';
import { MODELOS, INDICE_INICIAL, descripcionDeModelo } from './modelos';

// Abanico de tarjetas con forma de teléfono. La del centro va al frente, derecha y más grande; las
// de los lados salen rotadas, escalonadas hacia atrás y desbordando los costados de la pantalla.
//
// Las posiciones se calculan en JavaScript y se aplican como estilo en línea (en vez de resolver
// el hover con selectores CSS): el estilo en línea le gana en la cascada a cualquier regla de hoja
// de estilos, así que un `:hover { z-index }` NO podría levantar la tarjeta por encima de la del
// centro sin un `!important`. Con el índice elevado en el estado, la capa se calcula una sola vez
// y en un solo lugar.

const PASO_X = 58; // % del ancho de la tarjeta que se corre cada posición
const PASO_Y = 16; // px que baja cada posición, para el escalonado
const PASO_ROTACION = 7; // grados por posición
const PASO_ESCALA = 0.07;
const PASO_OPACIDAD = 0.13;
const VISIBLES = 3; // cuántas se ven a cada lado del centro
const ELEVACION = 26; // px que sube la tarjeta señalada
const ZOOM_ELEVADA = 0.05;
const SEPARACION = 7; // % que se apartan las vecinas de la señalada
// Cuánto hay que deslizar para que cuente como gesto y no como toque. Por debajo de esto, un dedo
// tembloroso movería el carrusel al querer tocar una tarjeta.
const MINIMO_DESLIZ = 45;

function estiloDeTarjeta(desplazamiento: number, elevada: boolean, empuje: number) {
  const distancia = Math.abs(desplazamiento);
  const fuera = distancia > VISIBLES;
  return {
    transform: [
      `translateX(calc(-50% + ${(desplazamiento * PASO_X + empuje).toFixed(2)}%))`,
      `translateY(${distancia * PASO_Y + (elevada ? -ELEVACION : 0)}px)`,
      `rotate(${desplazamiento * PASO_ROTACION}deg)`,
      `scale(${(1 - distancia * PASO_ESCALA + (elevada ? ZOOM_ELEVADA : 0)).toFixed(3)})`,
    ].join(' '),
    zIndex: elevada ? MODELOS.length + 10 : MODELOS.length - distancia,
    opacity: fuera ? 0 : 1 - distancia * PASO_OPACIDAD,
    // Invisible NO alcanza: en una pantalla ancha, una tarjeta con opacidad 0 sigue estando ahí y
    // se roba el click de quien creía tocar el fondo.
    pointerEvents: fuera ? ('none' as const) : undefined,
  };
}

export default function CarruselTarjetas() {
  const [actual, setActual] = useState(INDICE_INICIAL);
  // Cuál está señalada (mouse encima o con el foco del teclado). En un teléfono queda siempre en
  // null: el efecto de elevarse es un extra de escritorio, no la forma de usar el carrusel.
  const [elevada, setElevada] = useState<number | null>(null);
  const inicioDelToque = useRef<{ x: number; y: number } | null>(null);
  const huboDesliz = useRef(false);

  // Sin vuelta circular: al llegar a la punta el abanico se queda ahí. Dar la vuelta obligaría a
  // rebobinar las siete tarjetas de un lado al otro delante del usuario.
  const irA = (indice: number) => setActual(Math.min(Math.max(indice, 0), MODELOS.length - 1));
  const anterior = () => irA(actual - 1);
  const siguiente = () => irA(actual + 1);

  function alTocar(evento: TouchEvent) {
    const toque = evento.touches[0];
    inicioDelToque.current = { x: toque.clientX, y: toque.clientY };
    huboDesliz.current = false;
  }

  function alSoltar(evento: TouchEvent) {
    const inicio = inicioDelToque.current;
    inicioDelToque.current = null;
    if (!inicio) return;
    const toque = evento.changedTouches[0];
    const dx = toque.clientX - inicio.x;
    const dy = toque.clientY - inicio.y;
    // Solo si el gesto fue claramente horizontal: si no, la persona estaba haciendo scroll de la
    // página y el carrusel no tiene por qué robárselo.
    if (Math.abs(dx) < MINIMO_DESLIZ || Math.abs(dx) <= Math.abs(dy)) return;
    huboDesliz.current = true;
    if (dx < 0) siguiente();
    else anterior();
  }

  function alTocarTarjeta(indice: number) {
    // Un desliz termina en `click` sobre la tarjeta donde se levantó el dedo: sin esta guarda, el
    // gesto avanzaría una posición y el click la mandaría de vuelta.
    if (huboDesliz.current) {
      huboDesliz.current = false;
      return;
    }
    irA(indice);
  }

  const senalar = (indice: number) => (evento: PointerEvent) => {
    if (evento.pointerType === 'mouse') setElevada(indice);
  };
  const dejarDeSenalar = (indice: number) => (evento: PointerEvent) => {
    if (evento.pointerType === 'mouse') {
      setElevada((previa) => (previa === indice ? null : previa));
    }
  };

  return (
    <div
      className={estilos.carrusel}
      role="group"
      aria-roledescription="carrusel"
      aria-label="Ejemplos de tarjetas"
      onKeyDown={(evento) => {
        if (evento.key === 'ArrowLeft') {
          evento.preventDefault();
          anterior();
        } else if (evento.key === 'ArrowRight') {
          evento.preventDefault();
          siguiente();
        }
      }}
    >
      <div className={estilos.escenario} onTouchStart={alTocar} onTouchEnd={alSoltar}>
        {MODELOS.map((modelo, indice) => {
          const desplazamiento = indice - actual;
          const fuera = Math.abs(desplazamiento) > VISIBLES;
          const estaElevada = elevada === indice;
          const empuje =
            elevada === null || elevada === indice ? 0 : Math.sign(indice - elevada) * SEPARACION;

          return (
            <button
              key={modelo.id}
              type="button"
              className={estilos.tarjeta}
              style={estiloDeTarjeta(desplazamiento, estaElevada, empuje)}
              // Fuera del abanico visible no existe para nadie: ni para el mouse, ni para el
              // tabulador, ni para un lector de pantalla.
              tabIndex={fuera ? -1 : 0}
              aria-hidden={fuera}
              aria-label={
                indice === actual
                  ? descripcionDeModelo(modelo)
                  : `Ver ${descripcionDeModelo(modelo)}`
              }
              onClick={() => alTocarTarjeta(indice)}
              onPointerEnter={senalar(indice)}
              onPointerLeave={dejarDeSenalar(indice)}
              onFocus={() => setElevada(indice)}
              onBlur={() => setElevada((previa) => (previa === indice ? null : previa))}
            >
              <span className={estilos.lienzo} aria-hidden="true">
                <TarjetaModelo modelo={modelo} semilla={indice} />
              </span>
            </button>
          );
        })}
      </div>

      <div className={estilos.controles}>
        <button
          type="button"
          className={estilos.flecha}
          // aria-disabled en vez de `disabled`: un botón que se deshabilita justo cuando lo
          // acabás de activar pierde el foco y manda al teclado de vuelta al principio de la
          // página. Así queda enfocable, se anuncia como no disponible y el click no hace nada.
          aria-disabled={actual === 0}
          onClick={anterior}
          aria-label="Tarjeta anterior"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 5 8 12l7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className={estilos.puntos}>
          {MODELOS.map((modelo, indice) => (
            <button
              key={modelo.id}
              type="button"
              className={`${estilos.punto} ${indice === actual ? estilos.puntoActivo : ''}`}
              aria-label={`Ver la tarjeta de ${modelo.negocio}`}
              aria-current={indice === actual}
              onClick={() => irA(indice)}
            />
          ))}
        </div>

        <button
          type="button"
          className={estilos.flecha}
          aria-disabled={actual === MODELOS.length - 1}
          onClick={siguiente}
          aria-label="Tarjeta siguiente"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m9 5 7 7-7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <p className={estilos.soloLectores} aria-live="polite">
        {`Tarjeta ${actual + 1} de ${MODELOS.length}. ${descripcionDeModelo(MODELOS[actual])}`}
      </p>
    </div>
  );
}
