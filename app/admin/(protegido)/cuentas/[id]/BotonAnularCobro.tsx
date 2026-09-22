'use client';

import { useActionState, useState } from 'react';
import type { EstadoCobro } from '../actions';

// "Anular un cobro pendiente" (spec cobranza, "Acciones de FM" #5), de cualquier tipo. Mismo patrón
// de confirmación en dos pasos que MarcarPagado.tsx: anular no se puede deshacer desde acá.
export default function BotonAnularCobro({
  accion,
}: {
  accion: (estadoPrevio: EstadoCobro, formData: FormData) => Promise<EstadoCobro>;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoCobro, FormData>(accion, undefined);
  const [confirmando, setConfirmando] = useState(false);

  if (estado && 'ok' in estado) {
    return <p className="admin-fila-slug" role="status">Anulado.</p>;
  }

  return (
    <form action={ejecutar}>
      {confirmando ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="admin-eliminar" type="submit" disabled={pendiente}>
            {pendiente ? 'Anulando…' : 'Sí, anular'}
          </button>
          <button className="btn-borde" type="button" disabled={pendiente} onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button className="btn-borde" type="button" onClick={() => setConfirmando(true)}>
          Anular…
        </button>
      )}
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
