'use client';

import { useActionState } from 'react';
import { accionGuardarControles, type EstadoControles } from './actions';
import { ZONAS_HORARIAS } from '@/lib/comercio/zonasHorarias';
import type { ControlesAcreditacion } from '@/lib/comercio/controlesAcreditacion';

// CAMPOS NO CONTROLADOS + `key` derivada de los valores guardados. Es a propósito y va en contra de
// la convención del resto de los formularios del proyecto (useState controlado), así que vale la
// explicación — la encontró el QA del dueño el 2026-07-28:
//
// Al terminar un Server Action, esta versión de Next resetea el formulario. Un reset devuelve cada
// campo a su `defaultValue`/`defaultChecked`. Con campos CONTROLADOS eso desincroniza la casilla:
// el reset la desmarca en el DOM sin avisarle a React, y como React solo reescribe `checked` cuando
// el valor cambia entre renders —y en su estado seguía en true—, nunca la vuelve a marcar. El dato
// quedaba guardado bien en la base; solo se dibujaba mal. (Los campos numéricos no se veían porque
// React sí re-afirma `value` en cada render.)
//
// Con campos NO controlados el reset hace justo lo que queremos: los devuelve a los valores
// guardados. Y la `key` cubre el otro caso: cuando el guardado CAMBIA los valores, el formulario se
// remonta y vuelve a leer los defaults nuevos (un `defaultValue` que cambia no actualiza el DOM por
// sí solo). Entre los dos, las dos situaciones quedan cubiertas.
//
// Este es un formulario de EDICIÓN, a diferencia de FormularioRegla, que es de ALTA — ahí el reset
// es lo deseado y por eso aquel no necesita nada de esto.

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

  const aTexto = (valor: number | null) => (valor === null ? '' : String(valor));

  // Cambia solo cuando cambia algo YA GUARDADO, nunca mientras el dueño escribe: si dependiera de
  // lo que teclea, el formulario se remontaría en cada tecla y le borraría lo que va escribiendo.
  const clave = [
    controles.topeAcreditacionesDia,
    controles.esperaMinimaMinutos,
    controles.techoPuntosAcreditacion,
    controles.topePuntosDia,
    controles.pedirMontoCompra,
    controles.zonaHoraria,
  ].join('|');

  const unidad = esDePuntos ? 'acreditaciones' : 'sellos';

  return (
    <form key={clave} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
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
          defaultValue={aTexto(controles.topeAcreditacionesDia)}
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
          defaultValue={aTexto(controles.esperaMinimaMinutos)}
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
              defaultValue={aTexto(controles.techoPuntosAcreditacion)}
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
              defaultValue={aTexto(controles.topePuntosDia)}
            />
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="zona_horaria">Zona horaria del negocio</label>
        <select id="zona_horaria" name="zona_horaria" defaultValue={controles.zonaHoraria}>
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
            defaultChecked={controles.pedirMontoCompra}
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
