'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import { accionSubirImagen, accionQuitarImagen, type EstadoBranding } from './actions';

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
  const [estadoQuitar, ejecutarQuitar, pendienteQuitar] = useActionState<EstadoBranding, FormData>(
    accionQuitarImagen.bind(null, campo),
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
    <div className="subida-imagen">
      <form action={ejecutar} className="field" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
        <input type="hidden" name="campo" value={campo} />
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
        {pendiente && <p className="admin-fila-slug">Subiendo…</p>}
        {estado && 'error' in estado && (
          <p className="alerta" role="alert">{estado.error}</p>
        )}
        {estadoQuitar && 'error' in estadoQuitar && (
          <p className="alerta" role="alert">{estadoQuitar.error}</p>
        )}
      </form>
      {mostrada && (
        <form
          action={ejecutarQuitar}
          onSubmit={(e) => {
            if (!window.confirm(`¿Quitar ${etiqueta.toLowerCase()}? La tarjeta quedará sin esta imagen.`)) {
              e.preventDefault();
              return;
            }
            // Limpia también la vista previa local: si solo se había ELEGIDO un archivo (ya se
            // sube solo, pero por si el quitar gana la carrera) no debe quedar el espejismo.
            if (urlLocalRef.current) URL.revokeObjectURL(urlLocalRef.current);
            urlLocalRef.current = null;
            setPreviewLocal(null);
          }}
        >
          <button className="admin-eliminar" type="submit" disabled={pendienteQuitar || pendiente}>
            {pendienteQuitar ? 'Quitando…' : 'Quitar'}
          </button>
        </form>
      )}
    </div>
  );
}
