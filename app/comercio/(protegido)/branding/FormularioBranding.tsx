'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import { accionGuardarBranding, type EstadoBranding } from './actions';

type Props = {
  nombreComercio: string;
  esSellos: boolean;
  inicial: {
    color_fondo: string;
    color_texto: string;
    color_label: string;
    sello_meta: string;
  };
};

export default function FormularioBranding({ nombreComercio, esSellos, inicial }: Props) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionGuardarBranding,
    undefined,
  );

  // Controlados: para la vista previa en vivo y para no perder lo escrito si la acción rechaza.
  const [valores, setValores] = useState(inicial);
  const cambiar =
    (campo: keyof typeof inicial) =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  const metaEjemplo = valores.sello_meta && Number(valores.sello_meta) > 0 ? Number(valores.sello_meta) : 10;

  return (
    <>
      {/* Maqueta de colores — NO es el pass real (un .pkpass es un zip binario firmado, no se
          renderiza en el navegador). Solo muestra los colores elegidos en proporción de tarjeta. */}
      <div
        className="cardface"
        style={{ background: valores.color_fondo, color: valores.color_texto, marginBottom: 22 }}
      >
        <div className="cardface-top" style={{ color: valores.color_label }}>
          <span>Tarjeta de lealtad</span>
        </div>
        <div className="cardface-name">{nombreComercio}</div>
        <div className="cardface-points">
          {esSellos ? (
            <b style={{ fontSize: '1.4rem' }}>7 de {metaEjemplo} sellos</b>
          ) : (
            <>
              <b>0</b>
              <span style={{ color: valores.color_label }}>Puntos</span>
            </>
          )}
        </div>
      </div>

      <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
        {(
          [
            ['color_fondo', 'Color de fondo'],
            ['color_texto', 'Color de texto'],
            ['color_label', 'Color de etiqueta'],
          ] as const
        ).map(([campo, etiqueta]) => (
          <div className="field" key={campo}>
            <label htmlFor={campo}>{etiqueta}</label>
            <input
              id={campo}
              name={campo}
              value={valores[campo]}
              onChange={cambiar(campo)}
              placeholder="rgb(35, 24, 18)"
              required
            />
          </div>
        ))}

        {esSellos && (
          <div className="field">
            <label htmlFor="sello_meta">Meta de sellos</label>
            <input
              id="sello_meta"
              name="sello_meta"
              type="number"
              min="1"
              step="1"
              value={valores.sello_meta}
              onChange={cambiar('sello_meta')}
              placeholder="10"
            />
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar branding'}
        </button>
        {estado && 'error' in estado && (
          <p className="alerta" role="alert">{estado.error}</p>
        )}
        {estado && 'ok' in estado && (
          <p className="nota" style={{ textAlign: 'left' }}>Branding guardado.</p>
        )}
      </form>
    </>
  );
}
