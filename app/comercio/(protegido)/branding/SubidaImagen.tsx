'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import {
  accionSubirImagen,
  accionQuitarImagen,
  accionSubirImagenDePrograma,
  accionQuitarImagenDePrograma,
  type EstadoBranding,
} from './actions';
import { redimensionarImagen } from '@/lib/comercio/redimensionarImagen';

// Corto y llano, el mismo texto que el color de fondo. Solo el logo y la imagen de portada crean la
// tarjeta del programa en Google: la foto de la franja y el ícono del sello viven en el .pkpass y
// en la imagen de cada tarjeta, y son reversibles.
const AVISO_GOOGLE = 'Esto crea la tarjeta de este programa en Google Wallet y no se puede deshacer.';

export default function SubidaImagen({
  campo,
  etiqueta,
  urlActual,
  programaId = null,
  urlHeredada = null,
  avisaGoogle = false,
  cruzaLaLinea = false,
}: {
  campo: string;
  etiqueta: string;
  urlActual: string | null;
  /* null = imagen del NEGOCIO. Con id, imagen de esa tarjeta sola. */
  programaId?: string | null;
  /* Lo que la tarjeta está tomando del negocio: se muestra en gris cuando no tiene imagen propia,
     así el dueño VE qué está usando hoy en vez de una caja vacía. */
  urlHeredada?: string | null;
  /* Este campo viaja a la LoyaltyClass de Google (logo e imagen de portada). */
  avisaGoogle?: boolean;
  /* La tarjeta todavía no tiene NINGUNO de los tres campos que crean su tarjeta en Google: recién
     ahí subir esta imagen cruza la línea de lo irreversible y vale frenar al dueño una vez. */
  cruzaLaLinea?: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    programaId ? accionSubirImagenDePrograma.bind(null, programaId) : accionSubirImagen,
    undefined,
  );
  const [estadoQuitar, ejecutarQuitar, pendienteQuitar] = useActionState<EstadoBranding, FormData>(
    programaId
      ? accionQuitarImagenDePrograma.bind(null, programaId, campo)
      : accionQuitarImagen.bind(null, campo),
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

  const alElegir = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const archivo = input.files?.[0];
    if (urlLocalRef.current) URL.revokeObjectURL(urlLocalRef.current);
    if (!archivo || !archivo.type.startsWith('image/')) {
      urlLocalRef.current = null;
      setPreviewLocal(null);
      return;
    }

    // UNA sola confirmación, y solo la primera vez que esta tarjeta cruza a tener identidad propia
    // en Google. Después ya está creada y avisar de nuevo sería ruido.
    if (
      avisaGoogle &&
      cruzaLaLinea &&
      !window.confirm(`${AVISO_GOOGLE} ¿Seguimos?`)
    ) {
      input.value = '';
      urlLocalRef.current = null;
      setPreviewLocal(null);
      return;
    }

    const url = URL.createObjectURL(archivo);
    urlLocalRef.current = url;
    setPreviewLocal(url);

    // Una foto sacada con el teléfono pesa 3-6 MB y la app acepta 2: sin achicarla acá, el dueño
    // no puede poner una foto de su local desde el celular. Se reemplaza el archivo del input por
    // el redimensionado ANTES de enviar, así el FormData del Server Action lleva el liviano.
    // redimensionarImagen devuelve el original ante cualquier problema, así que este paso nunca
    // puede ser el motivo de que una imagen no se suba.
    const liviano = await redimensionarImagen(archivo, campo);
    if (liviano !== archivo) {
      const dt = new DataTransfer();
      dt.items.add(liviano);
      input.files = dt.files;
    }

    // La subida arranca SOLA al elegir el archivo. Antes exigía apretar "Subir" aparte, y la
    // vista previa instantánea hacía creer que ya estaba aplicado — al refrescar "volvía" la
    // imagen vieja porque nunca se subió (bug de UX visto en el piloto).
    input.form?.requestSubmit();
  };

  // Lo PROPIO (recién elegido o ya guardado) y lo que se MUESTRA: sin imagen propia, la heredada
  // del negocio, en gris. El botón de quitar cuelga de lo propio: no se puede "quitar" una imagen
  // que en realidad es del negocio.
  const propia = previewLocal ?? urlActual;
  const mostrada = propia ?? urlHeredada;
  const idCampo = programaId ? `${programaId}-${campo}` : campo;

  return (
    <div className="subida-imagen">
      <form action={ejecutar} className="field" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
        <input type="hidden" name="campo" value={campo} />
        <label htmlFor={`archivo-${idCampo}`}>{etiqueta}</label>
        {mostrada && (
          // eslint-disable-next-line @next/next/no-img-element -- vista previa simple, no vale next/image
          <img
            className="subida-preview"
            src={mostrada}
            alt={`Vista previa de ${etiqueta}`}
            style={propia ? undefined : { opacity: 0.45 }}
          />
        )}
        {programaId && !propia && (
          <p className="admin-fila-slug" style={{ marginTop: 2 }}>
            {urlHeredada ? 'La que usa tu negocio' : 'Sin imagen'}
          </p>
        )}
        <input
          id={`archivo-${idCampo}`}
          name="archivo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={alElegir}
          required
        />
        {avisaGoogle && (
          <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>{AVISO_GOOGLE}</p>
        )}
        {pendiente && <p className="admin-fila-slug">Subiendo…</p>}
        {estado && 'error' in estado && (
          <p className="alerta" role="alert">{estado.error}</p>
        )}
        {estadoQuitar && 'error' in estadoQuitar && (
          <p className="alerta" role="alert">{estadoQuitar.error}</p>
        )}
      </form>
      {propia && (
        <form
          action={ejecutarQuitar}
          onSubmit={(e) => {
            const pregunta = programaId
              ? `¿Quitar ${etiqueta.toLowerCase()} de esta tarjeta? Vuelve a usar la de tu negocio.`
              : `¿Quitar ${etiqueta.toLowerCase()}? La tarjeta quedará sin esta imagen.`;
            if (!window.confirm(pregunta)) {
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
