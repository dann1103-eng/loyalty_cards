'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import {
  accionSubirImagenPrograma,
  accionQuitarImagenPrograma,
  type EstadoPrograma,
} from './actions';
import { redimensionarImagen } from '@/lib/comercio/redimensionarImagen';

// Espeja SubidaImagen del branding del comercio, bindeada al programa. Vive aparte y no se
// generaliza aquella porque las dos apuntan a Server Actions distintos (tablas distintas, rutas de
// Storage distintas) y compartir el componente obligaría a pasar las acciones como props —
// más indirección que la que ahorra.
export default function SubidaImagenPrograma({
  programaId,
  campo,
  etiqueta,
  urlActual,
  urlHeredada,
  avisaIrreversible,
}: {
  programaId: string;
  campo: string;
  etiqueta: string;
  urlActual: string | null;
  // Lo que el programa está heredando del comercio: se muestra en gris cuando no tiene imagen
  // propia, así el dueño VE qué está usando hoy en vez de una caja vacía.
  urlHeredada: string | null;
  // logo y portada crean la LoyaltyClass del programa, que en Google es PERMANENTE.
  avisaIrreversible: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(
    accionSubirImagenPrograma.bind(null, programaId),
    undefined,
  );
  const [estadoQuitar, ejecutarQuitar, pendienteQuitar] = useActionState<EstadoPrograma, FormData>(
    accionQuitarImagenPrograma.bind(null, programaId, campo),
    undefined,
  );

  // Vista previa INSTANTÁNEA al elegir el archivo (antes de subir): object URL local.
  const [previewLocal, setPreviewLocal] = useState<string | null>(null);
  const urlLocalRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlLocalRef.current) URL.revokeObjectURL(urlLocalRef.current);
    };
  }, []);

  const alElegir = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const archivo = input.files?.[0];
    if (urlLocalRef.current) URL.revokeObjectURL(urlLocalRef.current);
    if (!archivo || !archivo.type.startsWith('image/')) {
      urlLocalRef.current = null;
      setPreviewLocal(null);
      return;
    }

    if (
      avisaIrreversible &&
      !window.confirm(
        `Darle ${etiqueta.toLowerCase()} propio a este programa crea su tarjeta en Google Wallet, y eso NO SE PUEDE DESHACER: Google no permite borrar la tarjeta una vez creada. ¿Seguimos?`,
      )
    ) {
      input.value = '';
      urlLocalRef.current = null;
      setPreviewLocal(null);
      return;
    }

    const url = URL.createObjectURL(archivo);
    urlLocalRef.current = url;
    setPreviewLocal(url);

    // Una foto sacada con el teléfono pesa 3-6 MB y la app acepta 2: sin achicarla acá, el dueño no
    // puede poner una foto desde el celular. redimensionarImagen devuelve el original ante
    // cualquier problema, así que nunca puede ser el motivo de que una imagen no se suba.
    const liviano = await redimensionarImagen(archivo, campo);
    if (liviano !== archivo) {
      const dt = new DataTransfer();
      dt.items.add(liviano);
      input.files = dt.files;
    }

    input.form?.requestSubmit();
  };

  const propia = previewLocal ?? urlActual;
  const mostrada = propia ?? urlHeredada;

  return (
    <div className="subida-imagen">
      <form action={ejecutar} className="field" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
        <input type="hidden" name="campo" value={campo} />
        <label htmlFor={`archivo-${programaId}-${campo}`}>{etiqueta}</label>
        {mostrada && (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa simple, no vale next/image
          <img
            className="subida-preview"
            src={mostrada}
            alt={`Vista previa de ${etiqueta}`}
            style={propia ? undefined : { opacity: 0.45 }}
          />
        )}
        {!propia && (
          <p className="admin-fila-slug" style={{ marginTop: 2 }}>
            {urlHeredada ? 'Heredada del comercio' : 'Sin imagen'}
          </p>
        )}
        <input
          id={`archivo-${programaId}-${campo}`}
          name="archivo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={alElegir}
          required
        />
        {pendiente && <p className="admin-fila-slug">Subiendo…</p>}
        {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
        {estadoQuitar && 'error' in estadoQuitar && (
          <p className="alerta" role="alert">{estadoQuitar.error}</p>
        )}
      </form>
      {propia && (
        <form
          action={ejecutarQuitar}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `¿Quitar ${etiqueta.toLowerCase()} de este programa? Vuelve a usar la del comercio.`,
              )
            ) {
              e.preventDefault();
              return;
            }
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
