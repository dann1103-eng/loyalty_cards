'use client';

import { useActionState, useState } from 'react';
import { accionGuardarControles, type EstadoControles } from './actions';
import { ZONAS_HORARIAS } from '@/lib/comercio/zonasHorarias';
import type { ControlesAcreditacion } from '@/lib/comercio/controlesAcreditacion';

// Campos CONTROLADOS con useState, no defaultValue: en esta versión de Next un Server Action
// resetea los campos no controlados al terminar, y este es un formulario de EDICIÓN — el dueño
// vería sus límites desaparecer del formulario después de guardarlos.

const aTexto = (valor: number | null) => (valor === null ? '' : String(valor));

export default function FormularioControles({
  controles,
  esDePuntos,
}: {
  controles: ControlesAcreditacion;
  esDePuntos: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoControles, FormData>(
    accionGuardarControles,
    undefined,
  );

  const [tope, setTope] = useState(aTexto(controles.topeAcreditacionesDia));
  const [espera, setEspera] = useState(aTexto(controles.esperaMinimaMinutos));
  const [techo, setTecho] = useState(aTexto(controles.techoPuntosAcreditacion));
  const [topePuntos, setTopePuntos] = useState(aTexto(controles.topePuntosDia));
  const [pedirMonto, setPedirMonto] = useState(controles.pedirMontoCompra);
  const [zona, setZona] = useState(controles.zonaHoraria);

  const unidad = esDePuntos ? 'acreditaciones' : 'sellos';

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Control de {unidad}</h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 18 }}>
        Dejá un campo vacío para no poner ese límite. Si alcanza un límite, el cajero queda
        bloqueado y solo vos podés autorizar la acreditación escribiendo un motivo.
      </p>

      <div className="field">
        <label htmlFor="tope_acreditaciones_dia">Máximo de {unidad} por cliente al día</label>
        <input
          id="tope_acreditaciones_dia"
          name="tope_acreditaciones_dia"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="Sin límite"
          value={tope}
          onChange={(e) => setTope(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="espera_minima_minutos">Minutos mínimos entre {unidad} al mismo cliente</label>
        <input
          id="espera_minima_minutos"
          name="espera_minima_minutos"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="Sin espera"
          value={espera}
          onChange={(e) => setEspera(e.target.value)}
        />
        {/* Es la perilla que de verdad ataja "le puso 5 seguidos": un tope diario de 2 no impide
            ponerlos en diez segundos. */}
        <p className="admin-fila-slug" style={{ marginTop: 6 }}>
          Un cliente que compra en la mañana y vuelve en la tarde pasa sin problema. Lo que esto
          evita es que se carguen varios de una sola vez.
        </p>
      </div>

      {esDePuntos && (
        <>
          <div className="field">
            <label htmlFor="techo_puntos_acreditacion">Máximo de puntos en una sola transacción</label>
            <input
              id="techo_puntos_acreditacion"
              name="techo_puntos_acreditacion"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Sin techo"
              value={techo}
              onChange={(e) => setTecho(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="tope_puntos_dia">Máximo de puntos por cliente al día</label>
            <input
              id="tope_puntos_dia"
              name="tope_puntos_dia"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Sin límite"
              value={topePuntos}
              onChange={(e) => setTopePuntos(e.target.value)}
            />
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="zona_horaria">Zona horaria del negocio</label>
        <select
          id="zona_horaria"
          name="zona_horaria"
          value={zona}
          onChange={(e) => setZona(e.target.value)}
        >
          {ZONAS_HORARIAS.map((z) => (
            <option key={z.valor} value={z.valor}>{z.etiqueta}</option>
          ))}
        </select>
        <p className="admin-fila-slug" style={{ marginTop: 6 }}>
          Define a qué hora corta el día para los límites diarios y para los reportes.
        </p>
      </div>

      <div className="field">
        <label htmlFor="pedir_monto_compra" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id="pedir_monto_compra"
            name="pedir_monto_compra"
            type="checkbox"
            checked={pedirMonto}
            onChange={(e) => setPedirMonto(e.target.checked)}
          />
          Pedir el monto de la compra al acreditar
        </label>
        <p className="admin-fila-slug" style={{ marginTop: 6 }}>
          Suma un paso al mostrador, pero deja ver cuánto se vendió por cada sello. Es lo que
          convierte una sospecha en evidencia.
        </p>
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar control'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'guardado' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>Control guardado.</p>
      )}
    </form>
  );
}
