'use client';

import { useActionState, useState } from 'react';
import type { AccionAdminPago } from '@/lib/comercios/pagosAdmin';
import { accionResolverPago, type EstadoPago } from './actions';

// Los botones de un pago. Qué botones salen lo decide `accionesDisponibles` (en el servidor), y la acción
// lo REVALIDA al ejecutarse: esto es solo la cara. Un solo formulario y un solo estado: cada botón manda
// su nombre en `accion`.
export default function AccionesPago({ eventoId, acciones }: { eventoId: string; acciones: AccionAdminPago[] }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoPago, FormData>(
    accionResolverPago.bind(null, eventoId),
    undefined,
  );
  // Aplicar a mano mueve plata y plan: pide una confirmación aparte antes de ejecutarse.
  const [confirmando, setConfirmando] = useState(false);

  if (acciones.length === 0 && !estado) return null;

  return (
    <form action={ejecutar} style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {acciones.includes('reintentar') && (
          <button className="btn-borde" type="submit" name="accion" value="reintentar" disabled={pendiente}>
            {pendiente ? 'Procesando…' : 'Reintentar'}
          </button>
        )}

        {acciones.includes('aplicar') &&
          (confirmando ? (
            <>
              <span className="admin-fila-slug">
                Se va a aplicar el plan y marcar el cobro como pagado aunque no coincida. ¿Seguro?
              </span>
              <button className="btn-primary" type="submit" name="accion" value="aplicar" disabled={pendiente}>
                {pendiente ? 'Aplicando…' : 'Sí, aplicar'}
              </button>
              <button className="btn-borde" type="button" disabled={pendiente} onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <button className="btn-primary" type="button" disabled={pendiente} onClick={() => setConfirmando(true)}>
              Aplicar a mano…
            </button>
          ))}

        {acciones.includes('revisado') && (
          <button className="btn-borde" type="submit" name="accion" value="revisado" disabled={pendiente}>
            Marcar revisado
          </button>
        )}
      </div>

      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'ok' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>{estado.ok}</p>
      )}
    </form>
  );
}
