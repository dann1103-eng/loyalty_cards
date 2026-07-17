'use client';

import { useActionState } from 'react';
import { accionCrearRecompensa, type EstadoRecompensa } from './actions';
import { TIPOS_RECOMPENSA } from '@/lib/comercio/recompensas';

export default function FormularioRecompensa() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoRecompensa, FormData>(
    accionCrearRecompensa,
    undefined,
  );

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" required />
      </div>
      <div className="field">
        <label htmlFor="descripcion">Descripción (opcional)</label>
        <input id="descripcion" name="descripcion" />
      </div>
      <div className="field">
        <label htmlFor="costo_puntos">Costo en puntos</label>
        <input id="costo_puntos" name="costo_puntos" type="number" min="1" step="1" required />
      </div>
      <div className="field">
        <label htmlFor="tipo">Tipo</label>
        <select id="tipo" name="tipo" defaultValue="articulo_gratis">
          {TIPOS_RECOMPENSA.map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="valor">Valor (opcional — ej. el código de descuento)</label>
        <input id="valor" name="valor" />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Agregando…' : 'Agregar recompensa'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
