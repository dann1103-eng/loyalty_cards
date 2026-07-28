'use client';

import { useActionState, useState } from 'react';
import { accionResolverSolicitud, type EstadoResolucion } from './actions';

// Un solo <textarea> compartido por los dos botones: el comentario es el mismo campo, cambia solo
// la decisión. Con dos formularios separados el operador tendría que escribir el motivo dos veces
// según qué botón termine tocando.
export default function BotonesResolucion({ solicitudId }: { solicitudId: string }) {
  const [comentario, setComentario] = useState('');
  const aprobar = accionResolverSolicitud.bind(null, solicitudId, true);
  const rechazar = accionResolverSolicitud.bind(null, solicitudId, false);

  const [estadoA, ejecutarA, pendienteA] = useActionState<EstadoResolucion, FormData>(aprobar, undefined);
  const [estadoR, ejecutarR, pendienteR] = useActionState<EstadoResolucion, FormData>(rechazar, undefined);

  const ocupado = pendienteA || pendienteR;
  const error =
    (estadoA && 'error' in estadoA && estadoA.error) ||
    (estadoR && 'error' in estadoR && estadoR.error) ||
    null;

  return (
    <div style={{ marginTop: 12 }}>
      <div className="field">
        <label htmlFor={`comentario-${solicitudId}`}>Comentario para el dueño</label>
        <textarea
          id={`comentario-${solicitudId}`}
          rows={2}
          maxLength={300}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Opcional al aprobar; al rechazar, decile por qué."
        />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <form action={ejecutarA}>
          <input type="hidden" name="comentario" value={comentario} />
          <button className="btn-primary" type="submit" disabled={ocupado}>
            {pendienteA ? 'Aprobando…' : 'Aprobar y aplicar'}
          </button>
        </form>
        <form action={ejecutarR}>
          <input type="hidden" name="comentario" value={comentario} />
          {/* Rechazar SIN comentario deja al dueño sin saber qué hacer, así que se exige. */}
          <button className="btn-borde" type="submit" disabled={ocupado || !comentario.trim()}>
            {pendienteR ? 'Rechazando…' : 'Rechazar'}
          </button>
        </form>
      </div>
      {error && <p className="alerta" role="alert">{error}</p>}
    </div>
  );
}
