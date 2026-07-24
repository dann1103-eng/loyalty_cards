'use client';

import { useState, useActionState } from 'react';
import type { EstadoFormulario } from './actions';

// Vincula un comercio EXISTENTE a esta cuenta (reasignación). Solo se renderiza cuando la cuenta
// tiene cupo; la capa lib (asignarComercioACuenta) igual reverifica el límite antes de mover nada.
export default function FormularioVincular({
  accion,
  disponibles,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  disponibles: { id: string; nombre: string }[];
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );
  const [comercioId, setComercioId] = useState(disponibles[0]?.id ?? '');

  if (disponibles.length === 0) {
    return <p className="field-aviso">No hay otros negocios para vincular.</p>;
  }

  return (
    <form action={ejecutar} className="field" style={{ marginTop: 14, marginBottom: 0 }}>
      <label htmlFor="comercio_id">Vincular un negocio existente</label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          id="comercio_id"
          name="comercio_id"
          value={comercioId}
          onChange={(e) => setComercioId(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        >
          {disponibles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <button className="btn-borde" type="submit" disabled={pendiente} style={{ marginTop: 0 }}>
          {pendiente ? 'Vinculando…' : 'Vincular'}
        </button>
      </div>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
