'use client';

import { useActionState, useState } from 'react';
import { accionGuardarPatronSellos, type EstadoBranding } from './actions';
import { llevaSegundoIcono, type PatronSello, type PatronSellos as Patron } from '@/lib/tarjetas/patronSellos';

// Dónde va el SEGUNDO ícono de sello (migración 0041). Aparece debajo de su subida, y solo cuando
// lo que se está diseñando tiene un segundo ícono propio: sin él no hay nada que repartir.
//
// Es su propio formulario con su propio botón, como cada SubidaImagen: vive en la pestaña Imágenes,
// fuera del <form> de Colores/Franja, y no viaja con "Publicar cambios".

// En el idioma del dueño, que piensa en su tarjeta de cartón y no en "patrones".
const OPCIONES: { valor: PatronSello; etiqueta: string }[] = [
  { valor: 'intercalado', etiqueta: 'Intercalados (uno y uno)' },
  { valor: 'mitades', etiqueta: 'Mitad y mitad' },
  { valor: 'ultimo', etiqueta: 'Solo el último (el del premio)' },
  { valor: 'casillas', etiqueta: 'En las casillas que yo elija' },
];

export default function PatronSellos({
  programaId,
  meta,
  inicial,
}: {
  /* null = el patrón del NEGOCIO. Con id, el de esa tarjeta sola. */
  programaId: string | null;
  /* Cuántas casillas tiene la grilla. null = el dueño todavía no puso la meta de sellos. */
  meta: number | null;
  inicial: Patron;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionGuardarPatronSellos.bind(null, programaId),
    undefined,
  );
  const [patron, setPatron] = useState<PatronSello>(inicial.patron);
  const [casillas, setCasillas] = useState<number[]>(inicial.casillas);

  // Sin meta no hay grilla que mostrar ni casillas que elegir: 10 es solo para dibujar el esquema.
  const total = meta ?? 10;
  const idBase = programaId ? `${programaId}-patron` : 'patron';

  const alternarCasilla = (n: number) =>
    setCasillas((v) => (v.includes(n) ? v.filter((c) => c !== n) : [...v, n].sort((a, b) => a - b)));

  return (
    <form action={ejecutar} className="field" style={{ marginTop: 4 }}>
      <span className="field-etiqueta">¿Dónde va el segundo sello?</span>
      <input type="hidden" name="casillas" value={casillas.join(',')} />
      <div className="encuadre-modos" role="radiogroup" aria-label="Dónde va el segundo sello" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        {OPCIONES.map(({ valor, etiqueta }) => (
          <label key={valor}>
            <input
              type="radio"
              name="patron"
              value={valor}
              checked={patron === valor}
              onChange={() => setPatron(valor)}
            />{' '}
            {etiqueta}
          </label>
        ))}
      </div>

      {/* El esquema de la grilla: se actualiza al tocar, antes de guardar. Con "casillas" cada
          círculo es un botón; con los otros patrones es solo el dibujo de cómo queda. */}
      <div
        role={patron === 'casillas' ? 'group' : 'img'}
        aria-label={
          patron === 'casillas'
            ? 'Tocá las casillas que llevan el segundo sello'
            : `Así se reparten: ${Array.from({ length: total }, (_, i) =>
                llevaSegundoIcono(i, total, { patron, casillas }) ? 'segundo' : 'primero',
              ).join(', ')}`
        }
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}
      >
        {Array.from({ length: total }, (_, i) => {
          const segundo = llevaSegundoIcono(i, total, { patron, casillas });
          const estilo = {
            width: 32,
            height: 32,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.78rem',
            fontWeight: 600,
            border: '1.5px solid var(--acento, currentColor)',
            background: segundo ? 'var(--acento, currentColor)' : 'transparent',
            color: segundo ? 'var(--fondo, #fff)' : 'inherit',
            padding: 0,
          } as const;
          return patron === 'casillas' ? (
            <button
              key={i}
              type="button"
              id={`${idBase}-casilla-${i + 1}`}
              aria-pressed={segundo}
              aria-label={`Casilla ${i + 1}`}
              onClick={() => alternarCasilla(i + 1)}
              style={{ ...estilo, cursor: 'pointer' }}
            >
              {i + 1}
            </button>
          ) : (
            <span key={i} aria-hidden="true" style={estilo}>
              {i + 1}
            </span>
          );
        })}
      </div>
      <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
        Las casillas rellenas llevan el segundo sello.
        {meta === null && ' Poné la meta de sellos en Colores para ver tu grilla real.'}
      </p>

      <button className="btn-acento" type="submit" disabled={pendiente} style={{ marginTop: 6 }}>
        {pendiente ? 'Guardando…' : 'Guardar dónde va'}
      </button>
      {estado && 'error' in estado && (
        <p className="alerta" role="alert">{estado.error}</p>
      )}
      {estado && 'ok' in estado && !pendiente && (
        <p className="nota" role="status" style={{ textAlign: 'left' }}>
          Listo. Las tarjetas ya se están actualizando.
        </p>
      )}
    </form>
  );
}
