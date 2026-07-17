'use client';

import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';

export default function BotonEliminar({
  accion,
  nombre,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  nombre: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  return (
    <div className="admin-zona-peligro">
      <form
        action={ejecutar}
        onSubmit={(e) => {
          // La confirmación es UX contra un clic accidental, NO el control de seguridad — ese
          // es verifyFmAdmin() dentro de la Server Action, más el FK de Postgres que rechaza
          // borrar cualquier comercio con datos reales asociados.
          if (!window.confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) {
            e.preventDefault();
          }
        }}
      >
        <button className="admin-eliminar" type="submit" disabled={pendiente}>
          {pendiente ? 'Eliminando…' : 'Eliminar comercio'}
        </button>
      </form>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </div>
  );
}
