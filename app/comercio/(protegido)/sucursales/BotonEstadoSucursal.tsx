'use client';

import { useActionState } from 'react';
import { accionCambiarEstado, type EstadoSucursal } from './actions';

// Toggle activar/desactivar. Nunca borra (la capa lib garantiza el soft-update). Solo pide
// confirmación al DESACTIVAR: reactivar es inocuo.
export default function BotonEstadoSucursal({
  id,
  nombre,
  activa,
}: {
  id: string;
  nombre: string;
  activa: boolean;
}) {
  // Estado DESTINO: si está activa el botón la desactiva; si no, la reactiva.
  const accion = accionCambiarEstado.bind(null, id, !activa);
  const [estado, ejecutar, pendiente] = useActionState<EstadoSucursal, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (
          activa &&
          !window.confirm(`¿Desactivar "${nombre}"? Podés reactivarla cuando quieras; su historial se conserva.`)
        ) {
          e.preventDefault();
        }
      }}
    >
      <button className={activa ? 'admin-eliminar' : 'btn-borde'} type="submit" disabled={pendiente}>
        {pendiente ? (activa ? 'Desactivando…' : 'Activando…') : activa ? 'Desactivar' : 'Activar'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
