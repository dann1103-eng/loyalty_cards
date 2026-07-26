'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import { accionRenombrarSucursal, type EstadoSucursal } from './actions';

// SOLO renombrar: el ALTA se mudó a ModalAgregarLocal ("¿Qué estás creando?" — sucursal vs comercio
// nuevo), así que este componente ya no tiene modos y `sucursal` es obligatorio.
// Input CONTROLADO (patrón anti-reset de FormularioComercio): un rechazo (nombre vacío, "ya no
// existe") NO borra lo que el dueño estaba editando.
export default function FormularioSucursal({
  sucursal,
}: {
  sucursal: { id: string; nombre: string };
}) {
  const accion = accionRenombrarSucursal.bind(null, sucursal.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoSucursal, FormData>(accion, undefined);

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
