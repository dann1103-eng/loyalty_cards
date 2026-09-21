'use client';

import { useActionState, useState } from 'react';
import type { EstadoMarcado } from '../actions';

// "Marcar pagado" de un cobro pendiente de la app. Aplica el plan y activa la licencia, o sea que pide una
// confirmación aparte: un clic suelto no debería mover el servicio de un cliente.
export default function MarcarPagado({
  accion,
}: {
  accion: (estadoPrevio: EstadoMarcado, formData: FormData) => Promise<EstadoMarcado>;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoMarcado, FormData>(accion, undefined);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <form action={ejecutar} style={{ marginTop: 8 }}>
      {confirmando ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="admin-fila-slug">Se aplica el plan y el cobro queda pagado. ¿Seguro?</span>
          <button className="btn-primary" type="submit" disabled={pendiente}>
            {pendiente ? 'Aplicando…' : 'Sí, marcar pagado'}
          </button>
          <button className="btn-borde" type="button" disabled={pendiente} onClick={() => setConfirmando(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button className="btn-borde" type="button" onClick={() => setConfirmando(true)}>
          Marcar pagado…
        </button>
      )}
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'ok' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>{estado.ok}</p>
      )}
    </form>
  );
}
