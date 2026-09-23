'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { accionGuardarControles, type EstadoControles } from './actions';
import { ZONAS_HORARIAS } from '@/lib/comercio/zonasHorarias';
import type { ControlesAcreditacion } from '@/lib/comercio/controlesAcreditacion';
import type { Unidad } from '@/lib/tarjetas/unidadPrograma';
import { formatearCentavos } from '@/lib/tarjetas/tipos';

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

// Las dos primeras perillas —el tope diario y la espera mínima— cuentan VECES, no unidades. En
// sellos y en prepago da lo mismo, porque cada operación vale exactamente un sello o una visita, y
// decirlo en la palabra del programa es lo que el dueño entiende ("Máximo de sellos por cliente al
// día"). En los otros seis tipos NO da lo mismo, y por eso hacen falta estas dos palabras.

// Puntos: una sola acreditación puede valer 50 puntos, así que la perilla que limita CUÁNTAS VECES
// no se puede llamar "puntos" — más abajo hay otra que sí limita puntos, y quedarían dos campos con
// la misma etiqueta queriendo decir cosas distintas.
const ACREDITACIONES: Unidad = { singular: 'acreditación', plural: 'acreditaciones', articulo: 'Las' };

// Los cinco tipos a los que `unidadPrograma` les devuelve null a propósito (gift card, cashback,
// cupón, membresía y descuento): no tienen una unidad de conteo que nombrar.
//
// Se eligió "operaciones" y no "escaneos" porque es lo que el control mide de verdad: el tope
// diario y la espera cuentan MOVIMIENTOS registrados sobre la tarjeta, y un escaneo que termina en
// error o que el cajero abandona no suma. Además "operación" cubre igual de bien renovar una
// membresía, usar un cupón y descontar saldo de una gift card, que es justo lo que estos cinco
// tipos hacen cuando el cajero escanea.
const OPERACIONES: Unidad = { singular: 'operación', plural: 'operaciones', articulo: 'Las' };

export default function FormularioControles({
  controles,
  unidad,
  esDePuntos,
  aplicanLimites,
  usaMontoDeCompra,
  ofreceReglaDeMonto,
}: {
  controles: ControlesAcreditacion;
  // Cómo se llama lo que cuenta ESTE programa. Reemplaza al viejo booleano `esDePuntos` para los
  // TEXTOS: con él, los seis tipos que no son de puntos leían "Control de sellos" y "Máximo de
  // sellos por cliente al día" — incluida una membresía, que no tiene sellos ni los va a tener.
  // null = el tipo no cuenta enteros, y entonces se habla de operaciones (ver OPERACIONES).
  unidad: Unidad | null;
  // Distinto de `unidad`: este no decide palabras sino qué CAMPOS existen. Los dos techos de puntos
  // solo tienen sentido donde una sola acreditación puede valer más de uno — en sellos, prepago y
  // los demás, cada operación vale exactamente una, así que el techo por transacción sería una
  // perilla que no hace nada.
  esDePuntos: boolean;
  // ¿Alguna operación de este tipo pasa por `acreditar_atomico`? Los cuatro límites de abajo viven
  // DENTRO de esa función (migración 0015) y ninguna otra los consulta, así que en cupón, membresía
  // y descuento el dueño estaba llenando perillas que su tarjeta no lee nunca. Ver
  // `aplicanControlesAcreditacion` en lib/tarjetas/tipos.ts, que trae la verificación RPC por RPC.
  //
  // La zona horaria y el monto de la compra NO se esconden con ellos: la zona es lo que decide a
  // qué hora vence un cupón en el mostrador (hoyEnZona), o sea que es MÁS importante justo en los
  // tipos donde los límites no aplican, y este formulario es el único lugar donde se puede elegir.
  // El monto tiene su propia pregunta (`usaMontoDeCompra`, abajo), que no separa los mismos tipos:
  // descuento recibe el monto sin pasar por acreditar_atomico.
  aplicanLimites: boolean;
  // ¿La operación del programa PRINCIPAL recibe el monto de la compra? En cupón, membresía y prepago
  // no (ver `usaMontoDeCompra` en lib/tarjetas/tipos.ts, con la verificación RPC por RPC): el cajero
  // tecleaba un monto que se descartaba. Mira el principal como el resto de esta pantalla; el
  // escáner, en cambio, decide por el tipo de cada tarjeta escaneada.
  usaMontoDeCompra: boolean;
  // ¿Algún programa del comercio —principal o secundario, activo o no— es de puntos o sellos? (Tarea
  // 4, `ofreceReglaDeMonto` en lib/comercio/montoAcreditacion.ts, calculada por
  // `datosFormularioControles` — datosControles.ts, compartida por page.tsx y por la prueba,
  // `dibujarReglas` en reglas/actions.test.ts.) Decide DOS cosas, y no las mismas que
  // `usaMontoDeCompra`: a diferencia de esa pregunta —que mira solo el PRINCIPAL—, un comercio de
  // membresía con un programa SECUNDARIO de sellos también necesita el checkbox "Pedir" (para poder
  // apagarlo) y el sub-bloque de "Exigir"/"Mínimo" — si esto dependiera solo de `usaMontoDeCompra`,
  // ese dueño tildaría "Exigir" (que prende "Pedir" por la implicación de `controlesDesdeFormulario`,
  // lib/comercio/controlesAcreditacion.ts) y después no tendría ningún control a la vista para volver
  // a apagar "Pedir".
  ofreceReglaDeMonto: boolean;
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
    controles.exigirMontoCompra,
    controles.montoMinimoCompraCentavos,
    controles.zonaHoraria,
  ].join('|');

  const palabra = esDePuntos ? ACREDITACIONES : (unidad ?? OPERACIONES);

  return (
    <form key={clave} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>
        {aplicanLimites ? `Control de ${palabra.plural}` : 'Ajustes del mostrador'}
      </h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 18 }}>
        {aplicanLimites
          ? 'Dejá un campo vacío para no poner ese límite. Si alcanza un límite, el cajero queda bloqueado y solo vos podés autorizar la acreditación escribiendo un motivo.'
          : 'A qué hora corta el día de tu negocio y qué le pedís al cajero en cada escaneo.'}
      </p>

      {!aplicanLimites && (
        <p className="admin-vacio">
          Tu tarjeta no se acredita: lo que hace tu cajero al escanear no pasa por estos límites, así
          que ponerlos acá no frenaría nada. Lo que define la mecánica de tu tarjeta está en{' '}
          <Link href="/comercio/programas">Programas de tarjeta</Link>.
        </p>
      )}

      {aplicanLimites && (
        <>
          <div className="field">
            <label htmlFor="tope_acreditaciones_dia">Máximo de {palabra.plural} por cliente al día</label>
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
            <label htmlFor="espera_minima_minutos">Minutos mínimos entre {palabra.plural} al mismo cliente</label>
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
        </>
      )}

      {/* Los límites no se dibujan, pero SÍ viajan: el Server Action lee los seis campos del
          formulario y lo que no llega se guarda como null. Sin estos, un dueño de membresía que
          entra a cambiar su zona horaria le borraría en silencio los topes que tenía puestos —— y
          los volvería a necesitar el día que su programa principal pase a ser de sellos. */}
      {!aplicanLimites && (
        <>
          <input type="hidden" name="tope_acreditaciones_dia" value={aTexto(controles.topeAcreditacionesDia)} />
          <input type="hidden" name="espera_minima_minutos" value={aTexto(controles.esperaMinimaMinutos)} />
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

      {(usaMontoDeCompra || ofreceReglaDeMonto) ? (
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
            Suma un paso al mostrador, pero te deja ver cuánto se vendió por cada {palabra.singular}.
            Es lo que convierte una sospecha en evidencia.
          </p>

          {/* Sub-bloque de la Tarea 4 (0039): exigir el monto y fijar un mínimo para que la
              acreditación cuente. Solo si ALGÚN programa del comercio es de puntos o sellos
              (`ofreceReglaDeMonto`, comentario del prop más arriba) — sin ningún programa que la
              regla alcance, esta configuración no gobierna nada. */}
          {ofreceReglaDeMonto && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borde-relieve)' }}>
              <label htmlFor="exigir_monto_compra" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  id="exigir_monto_compra"
                  name="exigir_monto_compra"
                  type="checkbox"
                  defaultChecked={controles.exigirMontoCompra}
                />
                Exigir el monto para sumar
              </label>
              <p className="admin-fila-slug" style={{ marginTop: 6 }}>
                También activa &quot;Pedir el monto de la compra al acreditar&quot;: no tiene sentido
                exigir un dato que no se pide. Al guardar, esa casilla de arriba va a quedar marcada
                sola.
              </p>

              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor="monto_minimo_compra">Mínimo de compra para sumar ($)</label>
                {/* type="text" inputMode="decimal", NO type="number": el valor precargado es
                    formatearCentavos(centavos), p. ej. "$10.50" — no es un número válido para un
                    input numérico, así que el navegador VACIARÍA el campo al montarlo y el dueño
                    perdería su mínimo guardado sin ninguna señal de que pasó. centavosDesdeTexto
                    (lib/tarjetas/tipos.ts) ya tolera el "$" al parsear de vuelta, así que no hace
                    falta que sea numérico. */}
                <input
                  id="monto_minimo_compra"
                  name="monto_minimo_compra"
                  type="text"
                  inputMode="decimal"
                  placeholder="Sin mínimo"
                  defaultValue={
                    controles.montoMinimoCompraCentavos === null
                      ? ''
                      : formatearCentavos(controles.montoMinimoCompraCentavos)
                  }
                />
                <p className="admin-fila-slug" style={{ marginTop: 6 }}>
                  Si lo llenás, el monto pasa a ser obligatorio.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="admin-vacio">
            Tu tarjeta no guarda el monto de la compra: lo que hace tu cajero al escanear no lo
            registra, así que pedírselo sería un paso de más sin nada que ver después.
          </p>
          {/* A esta rama se llega solo cuando NINGÚN programa del comercio —ni el principal ni
              ningún secundario— es de puntos o sellos: ni `usaMontoDeCompra` ni
              `ofreceReglaDeMonto` dieron true. Hoy, entonces, `pedir_monto_compra` no gobierna
              nada de verdad: el escáner lo lee (escanear/actions.ts), pero en gift card, cashback
              y descuento no cambia nada, porque `requiereMonto` (lib/tarjetas/tipos.ts) ya muestra
              el campo y la etiqueta depende solo de eso. Se conserva igual como input oculto
              (el Server Action la lee igual y lo que no llega lo guarda como false) por dos
              razones: la spec lo pide, y para el día que el dueño cree un programa SECUNDARIO de
              puntos o sellos — sin este input oculto, cualquier guardado mientras tanto (p. ej.
              cambiar la zona horaria) le habría apagado la perilla en silencio, y ese día la
              encontraría apagada sin haberla tocado nunca. "on" es lo que manda una casilla
              marcada; vacío se lee como apagada. */}
          <input type="hidden" name="pedir_monto_compra" value={controles.pedirMontoCompra ? 'on' : ''} />
        </>
      )}

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
