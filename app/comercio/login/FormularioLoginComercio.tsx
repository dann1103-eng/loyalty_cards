'use client';

import { useActionState } from 'react';
import { iniciarSesionComercio, type EstadoLogin } from './actions';

export default function FormularioLoginComercio({ mensajeInicial }: { mensajeInicial?: string }) {
  const [estado, accion, pendiente] = useActionState<EstadoLogin, FormData>(
    iniciarSesionComercio,
    undefined,
  );

  const mensaje = estado?.error ?? mensajeInicial;

  return (
    <form className="panel reveal d3" action={accion}>
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </button>
      {mensaje && (
        <p className="alerta" role="alert">
          {mensaje}
        </p>
      )}
    </form>
  );
}
