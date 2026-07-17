'use client';

import { useActionState } from 'react';
import { accionDesactivarRecompensa, type EstadoRecompensa } from './actions';

export default function BotonDesactivarRecompensa({ id, nombre }: { id: string; nombre: string }) {
  const accion = accionDesactivarRecompensa.bind(null, id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoRecompensa, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (!window.confirm(`¿Desactivar "${nombre}"? Dejará de estar disponible, pero su historial se conserva.`)) {
          e.preventDefault();
        }
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Desactivando…' : 'Desactivar'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
