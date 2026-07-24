'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import {
  accionCrearSucursal,
  accionRenombrarSucursal,
  type EstadoSucursal,
} from './actions';

// Doble propósito, espejando el resto del panel:
//  - Sin `sucursal` → modo CREAR: input NO controlado (como FormularioRecompensa). React 19 lo
//    limpia solo al terminar la action con éxito, listo para la próxima sucursal.
//  - Con `sucursal` → modo RENOMBRAR: input CONTROLADO (patrón anti-reset de FormularioComercio),
//    así un rechazo (nombre vacío, "ya no existe") NO borra lo que el dueño estaba editando.
// El modo queda fijo por instancia (el prop no cambia), así que el input nunca alterna entre
// controlado y no controlado.
export default function FormularioSucursal({
  sucursal,
}: {
  sucursal?: { id: string; nombre: string };
}) {
  if (sucursal) return <FormularioRenombrar sucursal={sucursal} />;
  return <FormularioCrear />;
}

function FormularioCrear() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoSucursal, FormData>(
    accionCrearSucursal,
    undefined,
  );

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre de la sucursal</label>
        <input id="nombre" name="nombre" placeholder="Sucursal Centro" required />
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Agregando…' : 'Agregar sucursal'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}

function FormularioRenombrar({ sucursal }: { sucursal: { id: string; nombre: string } }) {
  const accion = accionRenombrarSucursal.bind(null, sucursal.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoSucursal, FormData>(accion, undefined);

  // Controlado (anti-reset React 19): el nombre editado sobrevive a un submit rechazado.
  const [nombre, setNombre] = useState(sucursal.nombre);
  const cambiar = (e: ChangeEvent<HTMLInputElement>) => setNombre(e.target.value);

  return (
    <form action={ejecutar} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <input
            id={`renombrar-${sucursal.id}`}
            name="nombre"
            value={nombre}
            onChange={cambiar}
            aria-label={`Nuevo nombre para ${sucursal.nombre}`}
            required
          />
        </div>
        <button className="btn-borde" type="submit" disabled={pendiente} style={{ whiteSpace: 'nowrap' }}>
          {pendiente ? 'Guardando…' : 'Renombrar'}
        </button>
      </div>
      {estado?.error && <p className="alerta" role="alert" style={{ margin: 0 }}>{estado.error}</p>}
    </form>
  );
}
