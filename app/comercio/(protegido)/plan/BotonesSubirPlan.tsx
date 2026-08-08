'use client';

import { useActionState } from 'react';
import { accionSubirPlan, type EstadoSolicitudPlan } from './actions';
import { PLANES } from '@/lib/comercios/cuentas';

// Subir de plan, al instante y sin esperar a nadie.
//
// Por qué está SEPARADO del formulario de solicitud, en vez de ser una opción más de aquel select:
// son dos cosas distintas y confundirlas es lo que haría dudar al dueño. Acá el cambio ocurre al
// tocar; allá se manda un pedido y alguien contesta. Un solo control que a veces hace una cosa y a
// veces la otra es peor que dos controles honestos.
//
// Cada plan superior es su propio botón con su propio precio a la vista: el dueño ve exactamente
// qué va a pagar ANTES de tocar, no en una pantalla de confirmación posterior.
export default function BotonesSubirPlan({ planActual }: { planActual: string | null }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoSolicitudPlan, FormData>(
    accionSubirPlan,
    undefined,
  );

  // Los que están POR ENCIMA del actual, en el orden del catálogo. Una cuenta sin plan (índice -1)
  // ve los tres.
  const indiceActual = PLANES.findIndex((p) => p.valor === planActual);
  const superiores = PLANES.slice(indiceActual + 1);

  if (superiores.length === 0) return null;

  return (
    <section className="panel" style={{ marginTop: 0, marginBottom: 18 }}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>
        {indiceActual < 0 ? 'Elegí tu plan' : '¿Necesitás más lugar?'}
      </h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 14 }}>
        El cambio es inmediato: apenas lo tocás ya podés abrir tu local nuevo. El cobro lo
        coordinamos con vos, no te pedimos tarjeta acá.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {superiores.map((p) => (
          <form key={p.valor} action={ejecutar}>
            <input type="hidden" name="plan" value={p.valor} />
            <button
              className="btn-borde"
              type="submit"
              disabled={pendiente}
              style={{ width: '100%', justifyContent: 'space-between' }}
            >
              <span>
                Pasar a {p.etiqueta} ·{' '}
                {p.limiteSugerido === null
                  ? 'sin límite de locales'
                  : `hasta ${p.limiteSugerido} ${p.limiteSugerido === 1 ? 'local' : 'locales'}`}
              </span>
              <span className="dato-mono">${p.montoMensual}/mes</span>
            </button>
          </form>
        ))}
      </div>

      {estado && 'ok' in estado && (
        <p className="nota" role="status" style={{ color: 'var(--menta)', marginTop: 12 }}>
          Listo, ya estás en tu plan nuevo. Te escribimos para coordinar el cobro.
        </p>
      )}
      {estado && 'error' in estado && (
        <p className="alerta" role="alert" style={{ marginTop: 12 }}>{estado.error}</p>
      )}
    </section>
  );
}
