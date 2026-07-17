'use client';

import { useActionState } from 'react';
import { accionSubirImagen, type EstadoBranding } from './actions';

export default function SubidaImagen({
  campo,
  etiqueta,
  urlActual,
}: {
  campo: string;
  etiqueta: string;
  urlActual: string | null;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionSubirImagen,
    undefined,
  );

  return (
    <form className="subida-imagen" action={ejecutar}>
      <input type="hidden" name="campo" value={campo} />
      <div className="field">
        <label htmlFor={`archivo-${campo}`}>{etiqueta}</label>
        {urlActual && (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa simple, no vale next/image
          <img className="subida-preview" src={urlActual} alt={`Vista previa de ${etiqueta}`} />
        )}
        <input id={`archivo-${campo}`} name="archivo" type="file" accept="image/png,image/jpeg,image/webp" required />
      </div>
      <button className="admin-salir" type="submit" disabled={pendiente}>
        {pendiente ? 'Subiendo…' : 'Subir'}
      </button>
      {estado && 'error' in estado && (
        <p className="alerta" role="alert">{estado.error}</p>
      )}
    </form>
  );
}
