'use client';

import { useActionState, useState, type ChangeEvent } from 'react';
import type { EstadoCobro } from '../actions';
import { PLANES } from '@/lib/comercios/cuentas';

type Valores = {
  periodoDesde: string;
  periodoHasta: string;
  monto: string;
  plan: string;
};

function valoresIniciales(montoSugerido: number | null): Valores {
  return {
    // Sin default razonable: FM elige el período cada vez que pide un pago.
    periodoDesde: '',
    periodoHasta: '',
    monto: montoSugerido != null ? String(montoSugerido) : '',
    // '' = "— No cambia el plan —".
    plan: '',
  };
}

// "Pedir un pago al cliente" (spec cobranza, "Acciones de FM" #4): FM elige el monto (precargado con
// el del plan, editable — sirve para probar con $1), el plan (opcional: si lo hay, se aplica al
// pagar) y el período. Crea un cobro `pendiente` con `metodo = 'Pedido por FM'`; el dueño lo ve en su
// panel con un botón «Pagar $X» (accionPagarCobro, ya existe, ajeno a esta pantalla).
export default function FormularioPedirPago({
  accion,
  montoSugerido,
}: {
  accion: (estadoPrevio: EstadoCobro, formData: FormData) => Promise<EstadoCobro>;
  montoSugerido: number | null;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoCobro, FormData>(accion, undefined);

  // Los 4 campos CONTROLADOS, en un solo objeto — mismo patrón que FormularioComercio.tsx (y por la
  // misma razón, verificada ahí en el navegador): React 19 resetea los campos NO controlados cuando
  // la action del formulario termina, incluso si devolvió un error. Con `defaultValue`/sin controlar,
  // FM tecleaba período + monto + plan, se equivocaba invirtiendo las fechas ("El período termina
  // antes de empezar", validarCobro en cobros.ts), y perdía las tres cosas — de las que solo el
  // monto sobrevivía si únicamente ese campo estaba controlado.
  const [valores, setValores] = useState<Valores>(() => valoresIniciales(montoSugerido));

  const cambiar =
    (campo: keyof Valores) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  return (
    <form className="panel" style={{ marginTop: 14 }} action={ejecutar}>
      <p className="titulo-seccion" style={{ marginTop: 0 }}>Pedir un pago</p>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 12 }}>
        Crea un cobro pendiente que el dueño ve en su panel con un botón «Pagar». Sirve para probar
        con un monto chico, o para pedir un pago fuera del ciclo normal.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="pp_periodo_desde">Período desde</label>
          <input
            id="pp_periodo_desde"
            name="periodo_desde"
            type="date"
            value={valores.periodoDesde}
            onChange={cambiar('periodoDesde')}
            required
          />
        </div>
        <div className="field" style={{ flex: '1 1 150px' }}>
          <label htmlFor="pp_periodo_hasta">Hasta</label>
          <input
            id="pp_periodo_hasta"
            name="periodo_hasta"
            type="date"
            value={valores.periodoHasta}
            onChange={cambiar('periodoHasta')}
            required
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 120px' }}>
          <label htmlFor="pp_monto">Monto</label>
          <input
            id="pp_monto"
            name="monto"
            type="number"
            min="0"
            step="0.01"
            value={valores.monto}
            onChange={cambiar('monto')}
            required
          />
        </div>
        <div className="field" style={{ flex: '1 1 180px' }}>
          <label htmlFor="pp_plan">Plan (opcional)</label>
          <select id="pp_plan" name="plan" value={valores.plan} onChange={cambiar('plan')}>
            <option value="">— No cambia el plan —</option>
            {PLANES.map((p) => (
              <option key={p.valor} value={p.valor}>
                {p.etiqueta} (${p.montoMensual}/mes)
              </option>
            ))}
          </select>
          <p className="field-aviso">Si elegís un plan, se aplica cuando el dueño pague.</p>
        </div>
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Creando…' : 'Pedir pago'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'ok' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>
          Cobro creado. El dueño ya lo ve en su panel.
        </p>
      )}
    </form>
  );
}
