'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { EstadoCobro } from '../actions';
import { VALORES_COBRANZA } from '@/lib/comercios/cuentas';

type AccionCobro = (estadoPrevio: EstadoCobro, formData: FormData) => Promise<EstadoCobro>;

// Las tres acciones de FM que dependen de columnas de la migración 0038
// (cuentas_comercio.cobranza / cobranza_desde / cobranza_pospuesta_hasta): cambiarModoCobranza,
// posponerPago y perdonarCiclo (lib/comercios/modoCobranza.ts, Tarea 4b) — la migración quedó
// aplicada contra la base real en la Tarea 11, así que los tres controles corren de verdad.
// `modoActual`/`pospuestoHasta` los arrancan reflejando el estado REAL de la cuenta (la página ya
// calculó `estadoEfectivo` para la sección "Estado" de arriba y pasa las mismas columnas crudas).
export default function ControlesCobranzaFutura({
  accionModo,
  accionPosponer,
  accionPerdonar,
  modoActual,
  pospuestoHasta,
}: {
  accionModo: AccionCobro;
  accionPosponer: AccionCobro;
  accionPerdonar: AccionCobro;
  modoActual: 'normal' | 'exenta';
  pospuestoHasta: string | null;
}) {
  const [estadoModo, ejecutarModo, pendienteModo] = useActionState<EstadoCobro, FormData>(accionModo, undefined);
  const [estadoPosponer, ejecutarPosponer, pendientePosponer] = useActionState<EstadoCobro, FormData>(
    accionPosponer,
    undefined,
  );
  const [estadoPerdonar, ejecutarPerdonar, pendientePerdonar] = useActionState<EstadoCobro, FormData>(
    accionPerdonar,
    undefined,
  );
  const [modo, setModo] = useState<string>(modoActual);
  // Controlado (no defaultValue): así el mismo valor sirve para arrancar el campo Y para distinguir,
  // en el mensaje de éxito de abajo, si el último submit puso una fecha o la quitó (hasta: '').
  const [fechaPosponer, setFechaPosponer] = useState<string>(pospuestoHasta ?? '');
  const [confirmandoPerdon, setConfirmandoPerdon] = useState(false);

  // Tras perdonar con éxito, oculta el botón de confirmación (mismo patrón que
  // FormularioBranding.tsx: una ref espeja el `pendiente` anterior y el setState va DENTRO del
  // efecto, condicionado a la transición true→false CON éxito — nunca incondicional, que dispararía
  // el lint `react-hooks/set-state-in-effect`).
  const pendientePerdonarAnteriorRef = useRef(false);
  useEffect(() => {
    if (pendientePerdonarAnteriorRef.current && !pendientePerdonar && estadoPerdonar && 'ok' in estadoPerdonar) {
      setConfirmandoPerdon(false);
    }
    pendientePerdonarAnteriorRef.current = pendientePerdonar;
  }, [pendientePerdonar, estadoPerdonar]);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <p className="titulo-seccion" style={{ marginTop: 0 }}>Más acciones de cobranza</p>

      <form action={ejecutarModo} className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="cf_modo">Modo de cobranza</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            id="cf_modo"
            name="modo"
            value={modo}
            onChange={(e) => setModo(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
          >
            {VALORES_COBRANZA.map((v) => (
              <option key={v} value={v}>
                {v === 'normal' ? 'Normal (se cobra)' : 'Exenta (nunca se bloquea)'}
              </option>
            ))}
          </select>
          <button className="btn-borde" type="submit" disabled={pendienteModo} style={{ marginTop: 0 }}>
            {pendienteModo ? 'Guardando…' : 'Cambiar modo'}
          </button>
        </div>
        {estadoModo && 'error' in estadoModo && <p className="alerta" role="alert">{estadoModo.error}</p>}
        {estadoModo && 'ok' in estadoModo && (
          <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>Modo actualizado.</p>
        )}
      </form>

      <form action={ejecutarPosponer} className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="cf_hasta">Posponer el pago hasta</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            id="cf_hasta"
            name="hasta"
            type="date"
            value={fechaPosponer}
            onChange={(e) => setFechaPosponer(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          />
          <button className="btn-borde" type="submit" disabled={pendientePosponer} style={{ marginTop: 0 }}>
            {pendientePosponer ? 'Guardando…' : 'Posponer'}
          </button>
        </div>
        <p className="field-aviso">Dejar la fecha vacía y posponer quita una posposición existente.</p>
        {estadoPosponer && 'error' in estadoPosponer && <p className="alerta" role="alert">{estadoPosponer.error}</p>}
        {estadoPosponer && 'ok' in estadoPosponer && (
          <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>
            {fechaPosponer === '' ? 'Se quitó la posposición.' : 'Pago pospuesto.'}
          </p>
        )}
      </form>

      <div>
        <p className="admin-fila-slug" style={{ marginBottom: 6 }}>
          Perdonar el ciclo vencido: crea un cobro de $0 que lo cubre. No avisa a Meta.
        </p>
        <form action={ejecutarPerdonar}>
          {confirmandoPerdon ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn-primary" type="submit" disabled={pendientePerdonar} style={{ width: 'auto' }}>
                {pendientePerdonar ? 'Perdonando…' : 'Sí, perdonar este ciclo'}
              </button>
              <button
                className="btn-borde"
                type="button"
                disabled={pendientePerdonar}
                onClick={() => setConfirmandoPerdon(false)}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button className="btn-borde" type="button" onClick={() => setConfirmandoPerdon(true)}>
              Perdonar este ciclo…
            </button>
          )}
          {estadoPerdonar && 'error' in estadoPerdonar && <p className="alerta" role="alert">{estadoPerdonar.error}</p>}
          {estadoPerdonar && 'ok' in estadoPerdonar && (
            <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>Ciclo perdonado.</p>
          )}
        </form>
      </div>
    </div>
  );
}
