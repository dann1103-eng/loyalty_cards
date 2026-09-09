'use client';

import { useActionState } from 'react';
import { accionGuardarAvisoInactividad, type EstadoAvisoInactividad } from './actions';
import type { ConfiguracionAvisoInactividad } from '@/lib/comercio/avisoInactividad';
import { placeholderInactividad } from '@/lib/tarjetas/textosPorTipo';

// `tipoTarjeta` es el del programa PRINCIPAL, y entra por prop porque el placeholder del mensaje es
// lo que la mayoría de los dueños termina copiando tal cual: el que estaba cableado ("seguí
// sumando") le hacía prometer acumulación a quien vende membresías o cupones.
export default function FormularioAvisoInactividad({
  configuracion,
  tipoTarjeta,
}: {
  configuracion: ConfiguracionAvisoInactividad;
  tipoTarjeta: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoAvisoInactividad, FormData>(
    accionGuardarAvisoInactividad,
    undefined,
  );

  const clave = [configuracion.activo, configuracion.dias, configuracion.mensaje].join('|');

  return (
    <form key={clave} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Aviso de inactividad</h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 18 }}>
        Push automático a un cliente que no usa su tarjeta desde hace tiempo — sin depender de que
        pase cerca del local.
      </p>

      <div className="field">
        <label htmlFor="aviso_inactividad_activo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="aviso_inactividad_activo"
            name="aviso_inactividad_activo"
            type="checkbox"
            defaultChecked={configuracion.activo}
          />
          Activar el aviso de inactividad
        </label>
      </div>

      <div className="field">
        <label htmlFor="aviso_inactividad_dias">Días sin actividad antes de avisar</label>
        <input
          id="aviso_inactividad_dias"
          name="aviso_inactividad_dias"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="30"
          defaultValue={configuracion.dias === null ? '' : String(configuracion.dias)}
        />
      </div>

      <div className="field">
        <label htmlFor="aviso_inactividad_mensaje">Mensaje que recibe el cliente</label>
        <textarea
          id="aviso_inactividad_mensaje"
          name="aviso_inactividad_mensaje"
          rows={3}
          placeholder={placeholderInactividad(tipoTarjeta)}
          defaultValue={configuracion.mensaje ?? ''}
        />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar aviso'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'guardado' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>Aviso guardado.</p>
      )}
    </form>
  );
}
