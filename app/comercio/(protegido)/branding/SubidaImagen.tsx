'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
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

  // Vista previa INSTANTÁNEA al elegir el archivo (antes de subir): object URL local.
  // Al publicarse la subida real, revalidatePath refresca urlActual y este estado se limpia.
  const [previewLocal, setPreviewLocal] = useState<string | null>(null);
  const urlLocalRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlLocalRef.current) URL.revokeObjectURL(urlLocalRef.current);
    };
  }, []);

  const alElegir = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    if (urlLocalRef.current) URL.revokeObjectURL(urlLocalRef.current);
    if (archivo && archivo.type.startsWith('image/')) {
      const url = URL.createObjectURL(archivo);
      urlLocalRef.current = url;
      setPreviewLocal(url);
      // La subida arranca SOLA al elegir el archivo. Antes exigía apretar "Subir" aparte, y la
      // vista previa instantánea hacía creer que ya estaba aplicado — al refrescar "volvía" la
      // imagen vieja porque nunca se subió (bug de UX visto en el piloto).
      e.currentTarget.form?.requestSubmit();
    } else {
      urlLocalRef.current = null;
      setPreviewLocal(null);
    }
  };

  const mostrada = previewLocal ?? urlActual;

  return (
    <form className="subida-imagen" action={ejecutar}>
      <input type="hidden" name="campo" value={campo} />
      <div className="field">
        <label htmlFor={`archivo-${campo}`}>{etiqueta}</label>
        {mostrada && (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa simple, no vale next/image
          <img className="subida-preview" src={mostrada} alt={`Vista previa de ${etiqueta}`} />
        )}
        <input
          id={`archivo-${campo}`}
          name="archivo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={alElegir}
          required
        />
      </div>
      <button className="btn-borde" type="submit" disabled={pendiente}>
        <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">{pendiente ? 'progress_activity' : 'upload'}</span>
        {pendiente ? 'Subiendo…' : 'Volver a subir'}
      </button>
      {estado && 'error' in estado && (
        <p className="alerta" role="alert">{estado.error}</p>
      )}
    </form>
  );
}
