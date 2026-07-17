'use client';

import { useActionState } from 'react';
import { accionCrearRegla, type EstadoRegla } from './actions';
import { TIPOS_REGLA } from '@/lib/comercio/reglas';

export default function FormularioRegla() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoRegla, FormData>(accionCrearRegla, undefined);

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="tipo">Tipo de regla</label>
        <select id="tipo" name="tipo" defaultValue="por_visita">
          {TIPOS_REGLA.map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="valor">Valor (puntos por visita, o puntos por unidad de monto)</label>
        <input id="valor" name="valor" type="number" min="0.01" step="0.01" required />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Agregando…' : 'Agregar regla'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
