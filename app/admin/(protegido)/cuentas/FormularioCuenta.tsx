'use client';

import { useState, useActionState } from 'react';
import type { EstadoFormulario } from './actions';

export default function FormularioCuenta({
  accion,
  inicial,
  textoBoton,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: { nombre?: string; limite_negocios?: number };
  textoBoton: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  // Campos CONTROLADOS por el mismo motivo que FormularioComercio: React 19 resetea los campos no
  // controlados cuando una action del formulario termina —incluso si devolvió un error— así que con
  // defaultValue el admin perdería lo tecleado al rechazarse el guardado.
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [limite, setLimite] = useState(
    inicial?.limite_negocios != null ? String(inicial.limite_negocios) : '1',
  );

  return (
    <form className="panel" action={ejecutar} style={{ marginTop: 0 }}>
      <div className="field">
        <label htmlFor="nombre">Nombre de la cuenta</label>
        <input id="nombre" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="limite_negocios">Límite de negocios</label>
        <input
          id="limite_negocios"
          name="limite_negocios"
          type="number"
          min="1"
          step="1"
          value={limite}
          onChange={(e) => setLimite(e.target.value)}
          required
        />
        <p className="field-aviso">
          Cuántos comercios puede tener esta cuenta. Crear un comercio nuevo se bloquea al llegar al
          límite.
        </p>
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : textoBoton}
      </button>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
