'use client';

import { useActionState } from 'react';
import { accionDesactivarCajero, type EstadoCajero } from './actions';

// Da de baja a un cajero: borra su membresía → pierde el acceso al escáner. Pide confirmación porque
// es irreversible (para volver a habilitarlo hay que darlo de alta de nuevo). La cuenta de Auth no
// se toca; solo pierde el acceso a este comercio.
export default function BotonBajaCajero({ id, email }: { id: string; email: string }) {
  const accion = accionDesactivarCajero.bind(null, id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoCajero, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (!window.confirm(`¿Dar de baja a "${email}"? Perderá el acceso al escáner.`)) {
          e.preventDefault();
        }
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Dando de baja…' : 'Dar de baja'}
      </button>
      {estado?.error && <p className="alerta" role="alert" style={{ margin: 0 }}>{estado.error}</p>}
    </form>
  );
}
