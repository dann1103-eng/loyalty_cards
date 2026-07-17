'use client';

import { useActionState } from 'react';
import { accionEliminarRegla, type EstadoRegla } from './actions';

export default function BotonEliminarRegla({ id }: { id: string }) {
  const accion = accionEliminarRegla.bind(null, id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoRegla, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (!window.confirm('¿Eliminar esta regla?')) e.preventDefault();
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Eliminando…' : 'Eliminar'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
