'use client';

import { useActionState, useRef } from 'react';
import {
  accionSubirFotoRecompensa,
  accionQuitarFotoRecompensa,
  type EstadoFotoRecompensa,
} from './actions';
import { TAMANO_MAXIMO_BYTES } from '@/lib/comercio/imagenComercio';

// Subida de la foto de un premio. Mismo patrón que SubidaImagen del branding: el input dispara el
// submit solo al elegir el archivo, sin botón "Subir" aparte — un paso menos en la operación más
// común, y el estado pendiente ya da la señal de que algo está pasando.
//
// A diferencia del branding, NO se redimensiona en el cliente: aquel lo necesita porque el logo y
// la franja se meten dentro del .pkpass, donde cada kilobyte cuenta y el body de un Server Action
// se corta antes que el límite de 2 MB. Acá la foto solo se muestra en el escáner y en el portal,
// así que el límite de 2 MB alcanza sin agregar la complejidad del canvas.

export default function FotoRecompensa({
  recompensaId,
  fotoUrl,
  nombre,
}: {
  recompensaId: string;
  fotoUrl: string | null;
  nombre: string;
}) {
  const subir = accionSubirFotoRecompensa.bind(null, recompensaId);
  const quitar = accionQuitarFotoRecompensa.bind(null, recompensaId);
  const [estadoSubir, ejecutarSubir, subiendo] = useActionState<EstadoFotoRecompensa, FormData>(
    subir,
    undefined,
  );
  const [estadoQuitar, ejecutarQuitar, quitando] = useActionState<EstadoFotoRecompensa, FormData>(
    quitar,
    undefined,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const error =
    (estadoSubir && 'error' in estadoSubir && estadoSubir.error) ||
    (estadoQuitar && 'error' in estadoQuitar && estadoQuitar.error) ||
    null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {fotoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- URL pública del bucket
        <img
          src={fotoUrl}
          alt={`Foto de ${nombre}`}
          width={44}
          height={44}
          style={{
            width: 44,
            height: 44,
            objectFit: 'cover',
            borderRadius: 10,
            border: '1px solid var(--linea)',
          }}
        />
      )}

      <form action={ejecutarSubir}>
        <input
          ref={inputRef}
          type="file"
          name="archivo"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
        />
        <button
          type="button"
          className="btn-borde"
          disabled={subiendo || quitando}
          onClick={() => inputRef.current?.click()}
        >
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">image</span>
          {subiendo ? 'Subiendo…' : fotoUrl ? 'Cambiar foto' : 'Agregar foto'}
        </button>
      </form>

      {fotoUrl && (
        <form action={ejecutarQuitar}>
          <button type="submit" className="btn-borde" disabled={subiendo || quitando}>
            {quitando ? 'Quitando…' : 'Quitar'}
          </button>
        </form>
      )}

      {!fotoUrl && !error && (
        <span className="admin-fila-slug">
          PNG, JPG o WebP · máx. {Math.round(TAMANO_MAXIMO_BYTES / (1024 * 1024))} MB
        </span>
      )}
      {error && <p className="alerta" role="alert" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
