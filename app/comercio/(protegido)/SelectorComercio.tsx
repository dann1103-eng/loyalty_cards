'use client';

import { useTransition } from 'react';
import { cambiarComercioActivo } from '../actions';

// Selector del header para una cuenta que administra 2+ comercios (solo owner). Al cambiar de
// opción dispara el Server Action cambiarComercioActivo dentro de startTransition (mantiene la UI
// responsiva mientras la acción fija la cookie y revalida). La validación de que el id pertenece a
// la cuenta vive en el Server Action, no acá — el cliente nunca es la barrera de seguridad.
export default function SelectorComercio({
  comercios,
  activo,
}: {
  comercios: { comercioId: string; nombre: string }[];
  activo: string;
}) {
  const [pendiente, startTransition] = useTransition();

  return (
    <select
      aria-label="Cambiar de comercio activo"
      value={activo}
      disabled={pendiente}
      onChange={(e) => {
        const nuevoId = e.target.value;
        if (nuevoId === activo) return; // sin cambio: no re-dispares la acción
        startTransition(() => cambiarComercioActivo(nuevoId));
      }}
      style={{
        fontFamily: 'var(--font-body)',
        fontSize: '0.85rem',
        fontWeight: 600,
        color: 'var(--texto)',
        background: 'var(--superficie-3)',
        border: '1px solid var(--linea)',
        borderRadius: 'var(--radius-pill)',
        padding: '8px 14px',
        maxWidth: 180,
        cursor: pendiente ? 'progress' : 'pointer',
      }}
    >
      {comercios.map((c) => (
        <option key={c.comercioId} value={c.comercioId}>
          {c.nombre}
        </option>
      ))}
    </select>
  );
}
