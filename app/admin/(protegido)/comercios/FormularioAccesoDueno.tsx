'use client';

import { useActionState, useRef, useState } from 'react';
import type { EstadoAcceso } from './actions';

export type DuenoListado = { email: string; rol: string };

// Alta y recuperación del acceso del dueño, desde la ficha del comercio (Tarea 4 del plan
// 2026-07-26-acceso-dueno-invitacion). Reemplaza al `npm run seed-comercio` de la terminal, que
// además obligaba a FM a elegir —y por lo tanto a conocer— la contraseña del cliente.
//
// TODOS los formularios de acá comparten UN solo useActionState (`ejecutar` es una función común):
// el alta por correo y cada "Regenerar link". Así el resultado se muestra en un único bloque, en
// vez de repetirlo por fila. El costo es que `pendiente` desactiva todos los botones a la vez —
// deseable: dos links generados en paralelo se pisarían en pantalla y el perdido no se recupera.
//
// El link NO se persiste en ningún lado: vive solo en `estado`. Por eso la acción no revalida la
// página (revalidar remontaría esto y lo borraría de la pantalla).
export default function FormularioAccesoDueno({
  accion,
  duenos,
}: {
  accion: (estado: EstadoAcceso, formData: FormData) => Promise<EstadoAcceso>;
  duenos: DuenoListado[];
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoAcceso, FormData>(accion, undefined);
  const [copiado, setCopiado] = useState(false);
  const campoLink = useRef<HTMLInputElement>(null);

  // Regenerar SOLO para owners. A un cajero no se le toca la cuenta desde acá: lo crea el dueño en
  // su propio panel con la contraseña que él elige, y generarAccesoDueno crea membresía OWNER —
  // apuntarla a un cajero mezcla los dos roles en la misma cuenta. Los cajeros igual se listan
  // (FM tiene que ver quién entra al comercio), pero sin botón.
  const owners = duenos.filter((d) => d.rol === 'owner');
  const otros = duenos.filter((d) => d.rol !== 'owner');

  async function copiar(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles (o contexto no seguro): dejar el link seleccionado es el plan
      // B — desde ahí el propio teléfono ofrece "Copiar" con un toque.
      campoLink.current?.select();
    }
  }

  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <p className="admin-fila-slug" style={{ marginBottom: 6 }}>
        Los clientes escanean el QR y crean su tarjeta. Cuentas con acceso al panel del comercio:
      </p>

      {duenos.length === 0 ? (
        <p className="admin-fila-slug" style={{ margin: '4px 0 10px' }}>
          Todavía nadie puede entrar. Generá el acceso del dueño acá abajo.
        </p>
      ) : (
        <div style={{ margin: '8px 0 12px' }}>
          {owners.map((u) => (
            <div
              key={u.email}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0' }}
            >
              <span className="dato-mono" style={{ fontSize: '0.85rem' }}>{u.email}</span>
              <span className="pastilla pastilla-activo">{u.rol}</span>
              <form action={ejecutar} style={{ display: 'inline' }}>
                <input type="hidden" name="email" value={u.email} />
                <button
                  className="btn-borde"
                  type="submit"
                  disabled={pendiente}
                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                >
                  <span className="icono" style={{ fontSize: 16 }} aria-hidden="true">link</span>
                  Regenerar link
                </button>
              </form>
            </div>
          ))}
          {otros.map((u) => (
            <p key={u.email} style={{ margin: '6px 0' }}>
              <span className="dato-mono" style={{ fontSize: '0.85rem' }}>{u.email}</span>{' '}
              <span className="pastilla pastilla-activo">{u.rol}</span>
            </p>
          ))}
          {otros.length > 0 && (
            <p className="admin-fila-slug" style={{ marginTop: 6 }}>
              Los cajeros los da de alta el dueño desde su panel, con la contraseña que él elija.
            </p>
          )}
        </div>
      )}

      <form action={ejecutar}>
        <div className="field" style={{ marginBottom: 10 }}>
          <label htmlFor="email-dueno">Correo del dueño</label>
          <input
            id="email-dueno"
            name="email"
            type="email"
            placeholder="dueno@ejemplo.com"
            autoComplete="off"
            required
          />
        </div>
        <button className="btn-borde" type="submit" disabled={pendiente}>
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">key</span>
          {pendiente ? 'Generando…' : 'Generar acceso'}
        </button>
      </form>

      {estado && 'error' in estado && (
        <p className="alerta" role="alert">{estado.error}</p>
      )}

      {estado && 'link' in estado && (
        <div style={{ marginTop: 14 }}>
          <p className="admin-fila-slug" style={{ marginBottom: 6 }}>
            Link para <span className="dato-mono">{estado.email}</span> — mandáselo por WhatsApp:
          </p>
          {/* <input readOnly> y no un bloque de texto: en el teléfono un toque enfoca el campo y
              lo selecciona entero, sin pelear con la selección de texto suelto. */}
          <input
            ref={campoLink}
            className="dato-mono"
            type="text"
            readOnly
            value={estado.link}
            aria-label="Link de acceso del dueño"
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            style={{
              width: '100%',
              fontSize: '0.78rem',
              padding: '10px 12px',
              color: 'var(--texto)',
              background: 'var(--superficie-1)',
              border: '1px solid var(--linea)',
              borderRadius: 'var(--radius-field)',
            }}
          />
          <button
            className="btn-borde"
            type="button"
            onClick={() => copiar(estado.link)}
            style={{ marginTop: 8 }}
          >
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">content_copy</span>
            {copiado ? '¡Copiado!' : 'Copiar link'}
          </button>
          <p className="admin-fila-slug" style={{ marginTop: 8 }}>
            Se usa UNA sola vez y vence a las 24 horas. El cliente lo abre, elige su propia
            contraseña y entra. Si vence o la olvida, generá otro con “Regenerar link”. No se
            guarda en ningún lado: si cerrás esta página sin copiarlo, hay que generarlo de nuevo.
          </p>
        </div>
      )}
    </div>
  );
}
