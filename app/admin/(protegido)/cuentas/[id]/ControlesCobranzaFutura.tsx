'use client';

import { useActionState, useState } from 'react';
import type { EstadoCobro } from '../actions';
import { VALORES_COBRANZA } from '@/lib/comercios/cuentas';

type AccionCobro = (estadoPrevio: EstadoCobro, formData: FormData) => Promise<EstadoCobro>;

// Las tres acciones de FM que dependen de columnas de la migración 0038
// (cuentas_comercio.cobranza / cobranza_desde / cobranza_pospuesta_hasta), que todavía no está
// aplicada: cambiarModoCobranza, posponerPago y perdonarCiclo YA ESTÁN escritas y probadas
// (lib/comercios/modoCobranza.ts, Tarea 4b), pero escribir esas columnas hoy fallaría (no existen
// en la base real). Se arman los tres controles ya cableados a sus Server Actions reales — así
// cuando la Tarea 11 aplique la migración, habilitarlos es sacar la prop `disponible={false}` de la
// página que renderiza este componente, no rediseñar la pantalla.
export default function ControlesCobranzaFutura({
  accionModo,
  accionPosponer,
  accionPerdonar,
  disponible,
}: {
  accionModo: AccionCobro;
  accionPosponer: AccionCobro;
  accionPerdonar: AccionCobro;
  disponible: boolean;
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
  const [modo, setModo] = useState<string>('normal');
  const [confirmandoPerdon, setConfirmandoPerdon] = useState(false);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <p className="titulo-seccion" style={{ marginTop: 0 }}>Más acciones de cobranza</p>
      <p className="field-aviso" style={{ marginBottom: 14 }}>
        Disponible cuando se aplique la migración 0038: cambiar el modo, posponer un pago y perdonar
        un ciclo necesitan columnas que la base todavía no tiene.
      </p>

      <form action={ejecutarModo} className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="cf_modo">Modo de cobranza</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            id="cf_modo"
            name="modo"
            value={modo}
            onChange={(e) => setModo(e.target.value)}
            disabled={!disponible}
            style={{ flex: 1, minWidth: 180 }}
          >
            {VALORES_COBRANZA.map((v) => (
              <option key={v} value={v}>
                {v === 'normal' ? 'Normal (se cobra)' : 'Exenta (nunca se bloquea)'}
              </option>
            ))}
          </select>
          <button className="btn-borde" type="submit" disabled={!disponible || pendienteModo} style={{ marginTop: 0 }}>
            {pendienteModo ? 'Guardando…' : 'Cambiar modo'}
          </button>
        </div>
        {estadoModo && 'error' in estadoModo && <p className="alerta" role="alert">{estadoModo.error}</p>}
      </form>

      <form action={ejecutarPosponer} className="field" style={{ marginBottom: 18 }}>
        <label htmlFor="cf_hasta">Posponer el pago hasta</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input id="cf_hasta" name="hasta" type="date" disabled={!disponible} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn-borde" type="submit" disabled={!disponible || pendientePosponer} style={{ marginTop: 0 }}>
            {pendientePosponer ? 'Guardando…' : 'Posponer'}
          </button>
        </div>
        <p className="field-aviso">Dejar la fecha vacía y posponer quita una posposición existente.</p>
        {estadoPosponer && 'error' in estadoPosponer && <p className="alerta" role="alert">{estadoPosponer.error}</p>}
      </form>

      <div>
        <p className="admin-fila-slug" style={{ marginBottom: 6 }}>
          Perdonar el ciclo vencido: crea un cobro de $0 que lo cubre. No avisa a Meta.
        </p>
        <form action={ejecutarPerdonar}>
          {confirmandoPerdon ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn-primary" type="submit" disabled={!disponible || pendientePerdonar} style={{ width: 'auto' }}>
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
            <button
              className="btn-borde"
              type="button"
              disabled={!disponible}
              onClick={() => setConfirmandoPerdon(true)}
            >
              Perdonar este ciclo…
            </button>
          )}
          {estadoPerdonar && 'error' in estadoPerdonar && <p className="alerta" role="alert">{estadoPerdonar.error}</p>}
        </form>
      </div>
    </div>
  );
}
