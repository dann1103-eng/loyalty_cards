'use client';

import { useActionState } from 'react';
import { accionCrearCajero, type EstadoCajero } from './actions';
import type { SucursalListada } from '@/lib/comercio/sucursales';

// Alta de un cajero: correo + contraseña + sucursal. Input NO controlado (como FormularioRecompensa
// y FormularioSucursal en modo crear): React 19 limpia el formulario al terminar la action con
// éxito, listo para el próximo cajero. La contraseña viaja en el submit y NUNCA se loguea (ni acá
// ni en la action ni en la capa lib).
export default function FormularioCajero({ sucursales }: { sucursales: SucursalListada[] }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoCajero, FormData>(
    accionCrearCajero,
    undefined,
  );

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="email">Correo del cajero</label>
        <input
          id="email"
          name="email"
          type="email"
          placeholder="cajero@ejemplo.com"
          autoComplete="off"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder="Mínimo 8 caracteres"
          minLength={8}
          autoComplete="new-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="sucursalId">Sucursal</label>
        <select id="sucursalId" name="sucursalId" defaultValue="" required>
          <option value="" disabled>Elegí una sucursal</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Creando…' : 'Crear cajero'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
