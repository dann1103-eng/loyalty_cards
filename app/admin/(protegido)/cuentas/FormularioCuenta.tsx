'use client';

import { useState, useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { PLANES, ESTADOS_LICENCIA } from '@/lib/comercios/cuentas';

export default function FormularioCuenta({
  accion,
  inicial,
  textoBoton,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: {
    nombre?: string;
    limite_negocios?: number | null;
    plan?: string | null;
    licencia_estado?: string;
    licencia_monto_mensual?: number | null;
    licencia_activa_desde?: string | null;
  };
  textoBoton: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  // Campos CONTROLADOS por el mismo motivo que FormularioComercio: React 19 resetea los campos no
  // controlados cuando una action del formulario termina, incluso si devolvió un error.
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  // Cuenta NUEVA (sin `inicial`): precargar el primer plan, igual que el resto de los defaults.
  // Cuenta EXISTENTE con plan:null (backfill de la migración 0011 — demo/piloto, nunca tuvo un
  // plan real): dejar '' para forzar una elección explícita, en vez de mostrar "Starter" ya
  // seleccionado como si alguien lo hubiera decidido (ver placeholder deshabilitado más abajo).
  const [plan, setPlan] = useState(inicial?.plan ?? (inicial ? '' : PLANES[0].valor));
  const [limite, setLimite] = useState(
    inicial?.limite_negocios !== undefined
      ? (inicial.limite_negocios === null ? '' : String(inicial.limite_negocios))
      : String(PLANES[0].limiteSugerido ?? ''),
  );
  const [monto, setMonto] = useState(
    inicial?.licencia_monto_mensual != null ? String(inicial.licencia_monto_mensual) : String(PLANES[0].montoMensual),
  );
  const [licenciaEstado, setLicenciaEstado] = useState(inicial?.licencia_estado ?? 'activo');
  const [activaDesde, setActivaDesde] = useState(inicial?.licencia_activa_desde ?? '');

  // Elegir un plan PRECARGA monto y límite sugeridos — siguen siendo editables después (tratos
  // negociados), esto es solo una ayuda para no tipear de memoria los 3 valores del catálogo.
  const cambiarPlan = (nuevoPlan: string) => {
    setPlan(nuevoPlan);
    const p = PLANES.find((x) => x.valor === nuevoPlan);
    if (p) {
      setMonto(String(p.montoMensual));
      setLimite(p.limiteSugerido === null ? '' : String(p.limiteSugerido));
    }
  };

  return (
    <form className="panel" action={ejecutar} style={{ marginTop: 0 }}>
      <div className="field">
        <label htmlFor="nombre">Nombre de la cuenta</label>
        <input id="nombre" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="plan">Plan</label>
        <select id="plan" name="plan" value={plan} onChange={(e) => cambiarPlan(e.target.value)}>
          {plan === '' && <option value="" disabled>— Elegí un plan —</option>}
          {PLANES.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.etiqueta} (${p.montoMensual}/mes, {p.limiteSugerido ?? 'sin límite'})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="limite_negocios">Límite de negocios + sucursales</label>
        <input
          id="limite_negocios"
          name="limite_negocios"
          type="number"
          min="1"
          step="1"
          placeholder="Vacío = sin límite"
          value={limite}
          onChange={(e) => setLimite(e.target.value)}
        />
        <p className="field-aviso">
          Cuenta comercios distintos Y sucursales juntos. Se precarga según el plan; dejalo vacío
          para &quot;sin límite&quot; o ajustalo para un trato negociado.
        </p>
      </div>

      <div className="field">
        <label htmlFor="licencia_monto_mensual">Monto mensual</label>
        <input
          id="licencia_monto_mensual"
          name="licencia_monto_mensual"
          type="number"
          min="0"
          step="0.01"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="licencia_estado">Estado de licencia</label>
        <select
          id="licencia_estado"
          name="licencia_estado"
          value={licenciaEstado}
          onChange={(e) => setLicenciaEstado(e.target.value)}
        >
          {ESTADOS_LICENCIA.map((e) => (
            <option key={e} value={e}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </option>
          ))}
        </select>
        <p className="field-aviso">Pausar afecta TODOS los comercios de esta cuenta a la vez.</p>
      </div>

      <div className="field">
        <label htmlFor="licencia_activa_desde">Activa desde (opcional)</label>
        <input
          id="licencia_activa_desde"
          name="licencia_activa_desde"
          type="date"
          value={activaDesde}
          onChange={(e) => setActivaDesde(e.target.value)}
        />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : textoBoton}
      </button>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
