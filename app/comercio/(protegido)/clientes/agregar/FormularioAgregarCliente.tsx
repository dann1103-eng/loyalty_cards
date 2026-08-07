'use client';

import { useActionState, useState } from 'react';
import { accionAgregarClientePorTelefono, type EstadoAgregar } from './actions';
import { unidadPrograma } from '@/lib/tarjetas/unidadPrograma';

export interface ProgramaElegible {
  id: string;
  nombre: string;
  tipoTarjeta: string;
}

// La pantalla para el pedido a domicilio: el cliente nunca estuvo en el local, así que nadie pudo
// escanearle nada.
//
// Decisiones con la vara de "alguien de 50 años, solo":
// - Tres campos y nada más. El teléfono es la identidad (así lo guarda todo el sistema), el nombre
//   es lo que el cliente va a ver en su tarjeta, y la cantidad se dice en la unidad de SU programa.
// - No hay selector de sucursal: la atribución la pone el servidor desde el contexto activo. Un
//   campo más acá es un campo más que puede quedar mal.
// - El selector de tarjeta aparece SOLO si el comercio tiene más de una. Con una sola, elegir entre
//   una opción es una pregunta sin sentido.
export default function FormularioAgregarCliente({ programas }: { programas: ProgramaElegible[] }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoAgregar, FormData>(
    accionAgregarClientePorTelefono,
    undefined,
  );
  const [programaId, setProgramaId] = useState(programas[0]?.id ?? '');

  const elegido = programas.find((p) => p.id === programaId) ?? programas[0];
  const unidad = elegido ? unidadPrograma(elegido.tipoTarjeta) : null;
  // `unidad` null con un programa elegible solo puede ser dinero: los tipos sin contador ni siquiera
  // llegan a esta lista (ver page.tsx).
  const etiquetaCantidad = unidad ? `¿Cuántos ${unidad.plural} le das?` : '¿Cuántos centavos le cargás?';

  const exito = estado && 'ok' in estado;

  return (
    <form key={exito ? 'limpio' : 'edicion'} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="telefono">Teléfono del cliente</label>
        <input
          id="telefono"
          name="telefono"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="7777-1234"
          required
        />
        <p className="nota" style={{ marginTop: 6 }}>
          Es su identidad: si ya tiene tarjeta con vos, le sumamos a la que ya tiene.
        </p>
      </div>

      <div className="field">
        <label htmlFor="nombre">Nombre del cliente</label>
        <input id="nombre" name="nombre" type="text" maxLength={120} placeholder="María" required />
        <p className="nota" style={{ marginTop: 6 }}>
          Es el nombre que va a ver en su tarjeta.
        </p>
      </div>

      {programas.length > 1 && (
        <div className="field">
          <label htmlFor="programa_id">¿A cuál de tus tarjetas?</label>
          <select
            id="programa_id"
            name="programa_id"
            value={programaId}
            onChange={(e) => setProgramaId(e.target.value)}
          >
            {programas.map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>
      )}
      {programas.length === 1 && <input type="hidden" name="programa_id" value={programas[0].id} />}

      <div className="field">
        <label htmlFor="cantidad">{etiquetaCantidad}</label>
        <input
          id="cantidad"
          name="cantidad"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          defaultValue="1"
          required
        />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente} style={{ width: '100%' }}>
        {pendiente ? 'Guardando…' : 'Dar de alta y acreditar'}
      </button>

      {estado && 'ok' in estado && (
        <p className="nota" role="status" style={{ color: 'var(--menta)', marginTop: 12 }}>
          {estado.mensaje} Su tarjeta se actualiza sola.
        </p>
      )}
      {estado && 'error' in estado && (
        <p className="alerta" role="alert" style={{ marginTop: 12 }}>
          {estado.error}
          {/* Un bloqueo por una perilla antifraude NO es un fallo: es una regla del dueño haciendo
              su trabajo. Se dice qué hacer, porque desde acá no se puede autorizar. */}
          {estado.bloqueoLimite && ' El cliente ya quedó dado de alta: pedile al dueño que lo autorice desde el escáner.'}
        </p>
      )}
    </form>
  );
}
