'use client';

import { useActionState } from 'react';
import { accionCrearDifusion, type EstadoDifusion } from './actions';

export default function FormularioDifusion({
  programas,
  puedeCrear,
}: {
  programas: { id: string; nombre: string }[];
  puedeCrear: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoDifusion, FormData>(accionCrearDifusion, undefined);

  if (!puedeCrear) {
    return (
      <p className="admin-vacio">
        Ya usaste tus campañas de los últimos 30 días. Esperá a que se libere cupo.
      </p>
    );
  }

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Nueva campaña</h2>

      <div className="field">
        <label htmlFor="mensaje">Mensaje</label>
        <textarea id="mensaje" name="mensaje" rows={3} placeholder="20% de descuento este fin de semana" required />
      </div>

      <div className="field">
        <label htmlFor="vigente_hasta">Se muestra en la tarjeta hasta</label>
        <input id="vigente_hasta" name="vigente_hasta" type="date" required />
      </div>

      <div className="field">
        <label htmlFor="programa_id">Programa</label>
        <select id="programa_id" name="programa_id" defaultValue="">
          <option value="">Todos los programas</option>
          {programas.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Enviando…' : 'Mandar campaña'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
