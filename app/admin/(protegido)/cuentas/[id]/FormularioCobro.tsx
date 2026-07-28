'use client';

import { useActionState } from 'react';
import type { Cobro } from '@/lib/comercios/cobros';

export type EstadoCobro = { error: string } | { ok: true } | undefined;

// Campos NO controlados con `key`: es el mismo criterio que FormularioControles. Acá la `key`
// cuelga de la cantidad de cobros ya registrados, así que al guardar uno el formulario se remonta
// vacío y queda listo para el siguiente — que es lo que se quiere en un formulario de ALTA.
export default function FormularioCobro({
  accion,
  cobros,
  montoSugerido,
}: {
  accion: (estadoPrevio: EstadoCobro, formData: FormData) => Promise<EstadoCobro>;
  cobros: Cobro[];
  montoSugerido: number | null;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoCobro, FormData>(accion, undefined);

  return (
    <form key={cobros.length} className="panel" style={{ marginTop: 14 }} action={ejecutar}>
      <p className="titulo-seccion" style={{ marginTop: 0 }}>Registrar un cobro</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="periodo_desde">Período desde</label>
          <input id="periodo_desde" name="periodo_desde" type="date" required />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="periodo_hasta">Hasta</label>
          <input id="periodo_hasta" name="periodo_hasta" type="date" required />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="monto">Monto</label>
          {/* Se precarga el monto de la licencia: es el caso normal y evita teclearlo cada mes. */}
          <input
            id="monto"
            name="monto"
            type="number"
            min="0"
            step="0.01"
            defaultValue={montoSugerido ?? ''}
            required
          />
        </div>
        <div className="field" style={{ flex: '1 1 140px' }}>
          <label htmlFor="estado_cobro">Estado</label>
          <select id="estado_cobro" name="estado_cobro" defaultValue="pendiente">
            <option value="pendiente">Pendiente</option>
            <option value="pagado">Pagado</option>
            <option value="anulado">Anulado</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="pagado_en">Fecha de pago</label>
          {/* Obligatoria solo si el estado es "pagado" — lo valida la capa TS y también un CHECK de
              la BD. No se fuerza con `required` porque depende de otro campo. */}
          <input id="pagado_en" name="pagado_en" type="date" />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="metodo">Medio de pago</label>
          <input id="metodo" name="metodo" type="text" placeholder="Transferencia, efectivo…" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="nota">Nota</label>
        <input id="nota" name="nota" type="text" maxLength={200} />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Registrando…' : 'Registrar cobro'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
