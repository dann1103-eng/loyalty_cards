'use client';

import { useActionState } from 'react';
import { activarAcceso, type EstadoActivacion } from './actions';

// El token viaja en campos ocultos y el canje ocurre al SUBMIT (POST), no al abrir la página: es lo
// que impide que la vista previa de WhatsApp queme el link de un solo uso. Ver el comentario de
// actions.ts.
export default function FormularioActivar({
  tokenHash,
  tipo,
}: {
  tokenHash: string;
  tipo: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoActivacion, FormData>(
    activarAcceso,
    undefined,
  );

  return (
    <form className="panel reveal d3" action={ejecutar} style={{ width: '100%' }}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="tipo" value={tipo} />
      <button className="btn-primary" type="submit" disabled={pendiente} style={{ width: '100%' }}>
        {pendiente ? 'Activando…' : 'Activar mi acceso'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
