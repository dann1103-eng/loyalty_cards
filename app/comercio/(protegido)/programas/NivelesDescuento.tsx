'use client';

import { useActionState } from 'react';
import { accionCrearNivel, accionEliminarNivel, type EstadoPrograma } from './actions';
import { formatearCentavos } from '@/lib/tarjetas/tipos';
import type { NivelDescuento } from '@/lib/tarjetas/descuento';

// La escalera de descuentos del comercio: "desde $50 gastados, 5%".
//
// Sin al menos un nivel cargado, el tipo "Descuento por nivel" no hace NADA: el cajero registra las
// compras, el acumulado sube, y todos los clientes siguen en "Sin descuento todavía" porque
// nivelParaAcumulado no encuentra ningún umbral superado. Por eso el vacío de esta lista no es un
// estado neutro y se dice con todas las letras.
//
// El porcentaje se calcula al LEER y nunca se guarda en la tarjeta (ver lib/tarjetas/descuento.ts):
// tocar un umbral acá reordena a todos los clientes en el acto, incluidos los que ya compraron.

function BotonQuitar({ nivel }: { nivel: NivelDescuento }) {
  const accion = accionEliminarNivel.bind(null, nivel.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(accion, undefined);

  return (
    <form
      action={ejecutar}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `¿Quitar el nivel de ${nivel.porcentaje}% desde ${formatearCentavos(nivel.desdeCentavos)}? Los clientes que estaban en ese nivel bajan al anterior de inmediato.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button className="admin-eliminar" type="submit" disabled={pendiente}>
        {pendiente ? 'Quitando…' : 'Quitar'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}

export default function NivelesDescuento({ niveles }: { niveles: NivelDescuento[] }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(
    accionCrearNivel,
    undefined,
  );

  return (
    <div style={{ marginTop: 14 }}>
      <p className="titulo-seccion" style={{ marginBottom: 8 }}>Niveles de descuento</p>

      {niveles.length === 0 ? (
        <p className="alerta" role="alert" style={{ marginTop: 0 }}>
          Todavía no cargaste ningún nivel, así que este programa no le da descuento a nadie. Agregá
          el primero acá abajo.
        </p>
      ) : (
        <div className="admin-lista">
          {niveles.map((n) => (
            <div key={n.id} className="admin-fila">
              <div style={{ minWidth: 0 }}>
                <div className="admin-fila-nombre">{n.porcentaje}% de descuento</div>
                <div className="admin-fila-slug">
                  desde <span className="dato-mono">{formatearCentavos(n.desdeCentavos)}</span> gastados
                </div>
              </div>
              <BotonQuitar nivel={n} />
            </div>
          ))}
        </div>
      )}

      {/* `key` sobre la cantidad de niveles: al guardar uno nuevo, el formulario se remonta con los
          campos en blanco. Sin eso el dueño ve el nivel ya agregado abajo y los mismos valores
          arriba, y no sabe si se guardó. */}
      <form key={niveles.length} action={ejecutar} style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 130px', marginBottom: 0 }}>
            <label htmlFor="nivel-desde">Desde cuánto gastado ($)</label>
            <input
              id="nivel-desde"
              name="desde"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="50.00"
              required
            />
          </div>
          <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}>
            <label htmlFor="nivel-porcentaje">Descuento (%)</label>
            <input
              id="nivel-porcentaje"
              name="porcentaje"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              inputMode="decimal"
              placeholder="5"
              required
            />
          </div>
        </div>
        <button className="btn-borde" type="submit" style={{ marginTop: 10 }} disabled={pendiente}>
          {pendiente ? 'Agregando…' : 'Agregar nivel'}
        </button>
        {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      </form>

      <p className="nota" style={{ marginTop: 10, marginBottom: 0 }}>
        Gana el nivel más alto que el cliente ya superó. El gasto acumulado nunca baja: canjear o
        pagar no le quita el nivel a nadie.
      </p>
    </div>
  );
}
