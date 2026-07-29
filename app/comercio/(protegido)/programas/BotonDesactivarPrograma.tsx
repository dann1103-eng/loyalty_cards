'use client';

import { useActionState } from 'react';
import { accionDesactivarPrograma, type EstadoPrograma } from './actions';

export default function BotonDesactivarPrograma({ id, nombre }: { id: string; nombre: string }) {
  const accion = accionDesactivarPrograma.bind(null, id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `¿Desactivar "${nombre}"? Las tarjetas ya emitidas siguen funcionando, pero nadie más va a poder registrarse en este programa.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Desactivando…' : 'Desactivar'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
