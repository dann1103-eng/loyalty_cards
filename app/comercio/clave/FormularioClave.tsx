'use client';

import { useActionState } from 'react';
import { definirClave, type EstadoClave } from './actions';

// Contraseña + confirmación. Inputs NO controlados (como FormularioLoginComercio): la contraseña
// viaja en el submit y no queda en ningún estado de React, ni vuelve en el estado de la action, ni
// se loguea en ningún lado.
export default function FormularioClave() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoClave, FormData>(
    definirClave,
    undefined,
  );

  return (
    <form className="panel reveal d3" action={ejecutar}>
      <div className="field">
        <label htmlFor="password">Tu contraseña</label>
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
        <label htmlFor="confirmacion">Repetila</label>
        <input
          id="confirmacion"
          name="confirmacion"
          type="password"
          placeholder="La misma otra vez"
          minLength={8}
          autoComplete="new-password"
          required
        />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar y entrar'}
        {!pendiente && (
          <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">arrow_forward</span>
        )}
      </button>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
