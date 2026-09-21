'use client';

import { useActionState } from 'react';
import type { VistaPagos } from '@/lib/comercios/vistaOpciones';
import { accionIniciarPago, type EstadoPagoPlan } from './actions';

// Las opciones para pagar el plan: elegir, subir o renovar. NO decide nada: el texto, los importes y qué
// opciones hay salen de lib/comercios/vistaOpciones.ts (que sale de opcionesPago.ts, la misma fuente que
// usa el servidor al cobrar). Tocar una opción crea el cobro y lleva al dueño a la pantalla de pago de
// Wompi; el plan cambia cuando el pago se confirma, no acá.
//
// Cada opción es su propio formulario con su plan y su acción a la vista, para que el dueño vea
// exactamente qué va a pagar ANTES de tocar, no en una pantalla de confirmación posterior. El formulario
// manda solo el plan y la acción, nunca un monto.
export default function OpcionesDePago({ vista }: { vista: VistaPagos }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoPagoPlan, FormData>(accionIniciarPago, undefined);

  if (vista.opciones.length === 0 && vista.aviso === null && vista.proximoPago === null) return null;

  return (
    <section className="panel" style={{ marginTop: 0, marginBottom: 18 }} aria-busy={pendiente}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>{vista.titulo}</h2>
      {vista.explicacion && (
        <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 14 }}>{vista.explicacion}</p>
      )}
      {vista.proximoPago && <p className="admin-fila-slug" style={{ marginTop: 0 }}>{vista.proximoPago}</p>}
      {vista.aviso && <p className="nota" role="status">{vista.aviso}</p>}

      {vista.opciones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {vista.opciones.map((o) => (
            <form key={o.clave} action={ejecutar}>
              <input type="hidden" name="plan" value={o.plan} />
              <input type="hidden" name="accion" value={o.accion} />
              <button
                className="btn-borde"
                type="submit"
                disabled={pendiente || o.bloqueadaPor !== null}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <span>{o.titulo}</span>
                <span className="dato-mono">{o.importe}</span>
              </button>
              {/* Una opción bloqueada dice POR QUÉ en lugar de su detalle: es lo que el dueño tiene que saber. */}
              <p className="admin-fila-slug" style={{ margin: '6px 4px 0' }}>{o.bloqueadaPor ?? o.detalle}</p>
            </form>
          ))}
        </div>
      )}

      {pendiente && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 12 }}>
          Te llevamos a la pantalla de pago…
        </p>
      )}
      {estado && 'error' in estado && <p className="alerta" role="alert" style={{ marginTop: 12 }}>{estado.error}</p>}
    </section>
  );
}
