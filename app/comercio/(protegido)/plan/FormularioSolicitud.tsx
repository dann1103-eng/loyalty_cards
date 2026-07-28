'use client';

import { useActionState } from 'react';
import { accionSolicitarPlan, type EstadoSolicitudPlan } from './actions';
import { PLANES } from '@/lib/comercios/cuentas';

// Campos NO controlados, igual que FormularioControles: es de edición y el reset posterior al
// Server Action desincroniza los campos controlados (ver el comentario largo de aquel archivo).
export default function FormularioSolicitud({ planActual }: { planActual: string | null }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoSolicitudPlan, FormData>(
    accionSolicitarPlan,
    undefined,
  );

  const disponibles = PLANES.filter((p) => p.valor !== planActual);

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Cambiar de plan</h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 16 }}>
        Nos llega tu solicitud y la revisamos. El cambio no es automático: te confirmamos antes de
        aplicarlo.
      </p>

      <div className="field">
        <label htmlFor="plan">Plan que querés</label>
        <select id="plan" name="plan" defaultValue={disponibles[0]?.valor}>
          {disponibles.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.etiqueta} — ${p.montoMensual}/mes ·{' '}
              {p.limiteSugerido === null ? 'sin límite' : `hasta ${p.limiteSugerido}`}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="motivo">¿Por qué? (opcional)</label>
        <textarea id="motivo" name="motivo" rows={2} maxLength={300} placeholder="Ej.: abrimos una sucursal nueva" />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Enviando…' : 'Solicitar cambio'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'ok' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>
          Solicitud enviada. Te avisamos apenas la revisemos.
        </p>
      )}
    </form>
  );
}
