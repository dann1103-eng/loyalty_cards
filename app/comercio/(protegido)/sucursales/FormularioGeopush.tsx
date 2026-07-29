'use client';

import { useActionState } from 'react';
import { accionGuardarGeopush, type EstadoGeopush } from './actions';
import { LARGO_MAXIMO_MENSAJE_CERCANIA } from '@/lib/comercio/geopush';

// Campos NO controlados con `key` derivada de lo guardado, igual que FormularioControles: es un
// formulario de EDICIÓN, y con estado controlado el reset que hace Next al terminar un Server
// Action desmarca la casilla en el DOM sin avisarle a React. Ver el comentario largo de aquel
// archivo — el bug lo encontró el QA del dueño el 2026-07-28.

export interface SucursalGeopush {
  id: string;
  nombre: string;
  latitud: number | null;
  longitud: number | null;
  mensajeCercania: string | null;
  mensajeCampana: string | null;
  campanaHasta: string | null;
  geopushActivo: boolean;
}

export default function FormularioGeopush({ sucursal }: { sucursal: SucursalGeopush }) {
  const accion = accionGuardarGeopush.bind(null, sucursal.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoGeopush, FormData>(accion, undefined);

  const tieneUbicacion = sucursal.latitud !== null && sucursal.longitud !== null;
  const clave = [
    sucursal.latitud,
    sucursal.longitud,
    sucursal.mensajeCercania,
    sucursal.mensajeCampana,
    sucursal.campanaHasta,
    sucursal.geopushActivo,
  ].join('|');

  return (
    <details style={{ marginTop: 4 }}>
      <summary className="admin-fila-slug" style={{ cursor: 'pointer' }}>
        <span className="icono" style={{ fontSize: 16, verticalAlign: 'middle' }} aria-hidden="true">
          location_on
        </span>{' '}
        Aviso por cercanía
        {sucursal.geopushActivo ? (
          <span style={{ color: 'var(--acento)' }}> · activo</span>
        ) : tieneUbicacion ? (
          <span> · ubicación cargada, aviso apagado</span>
        ) : (
          <span> · sin configurar</span>
        )}
      </summary>

      <form key={clave} action={ejecutar} style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor={`ubicacion-${sucursal.id}`}>Ubicación del local</label>
          <input
            id={`ubicacion-${sucursal.id}`}
            name="ubicacion"
            type="text"
            placeholder="Pegá acá el link de Google Maps"
            defaultValue={tieneUbicacion ? `${sucursal.latitud}, ${sucursal.longitud}` : ''}
          />
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Buscá tu local en Google Maps, tocá Compartir, copiá el link y pegalo acá. También
            funciona si pegás las coordenadas separadas por coma.
          </p>
        </div>

        <div className="field">
          <label htmlFor={`mensaje-${sucursal.id}`}>
            Mensaje permanente (máx. {LARGO_MAXIMO_MENSAJE_CERCANIA})
          </label>
          <input
            id={`mensaje-${sucursal.id}`}
            name="mensaje_cercania"
            type="text"
            maxLength={LARGO_MAXIMO_MENSAJE_CERCANIA}
            placeholder="Pasá por tu café, ya tenés sellos acumulados"
            defaultValue={sucursal.mensajeCercania ?? ''}
          />
          {/* Honestidad sobre la asimetría, que es la política del proyecto: prometerle al dueño que
              su mensaje se ve en todos los teléfonos sería falso y lo descubriría probando. */}
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Este texto se ve en iPhone. En Android llega la notificación igual, pero el texto lo pone
            Google y no se puede cambiar.
          </p>
        </div>

        {/* Campaña temporal. Va DEBAJO del permanente y con su fecha al lado para que quede claro
            que uno tapa al otro y que el de arriba vuelve solo cuando esta termina. */}
        <div className="field">
          <label htmlFor={`campana-${sucursal.id}`}>Promoción temporal (opcional)</label>
          <input
            id={`campana-${sucursal.id}`}
            name="mensaje_campana"
            type="text"
            maxLength={LARGO_MAXIMO_MENSAJE_CERCANIA}
            placeholder="2x1 en hotdogs este fin de semana"
            defaultValue={sucursal.mensajeCampana ?? ''}
          />
        </div>

        <div className="field">
          <label htmlFor={`hasta-${sucursal.id}`}>La promoción se muestra hasta</label>
          <input
            id={`hasta-${sucursal.id}`}
            name="campana_hasta"
            type="date"
            defaultValue={sucursal.campanaHasta ?? ''}
          />
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Mientras dure, tapa al mensaje permanente. Ese día todavía se muestra, y al siguiente
            vuelve solo el de arriba — no tenés que acordarte de borrarla.
          </p>
        </div>

        <div className="field">
          <label htmlFor={`activo-${sucursal.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id={`activo-${sucursal.id}`}
              name="geopush_activo"
              type="checkbox"
              defaultChecked={sucursal.geopushActivo}
            />
            Avisar a los clientes que pasen cerca de este local
          </label>
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            El aviso salta a unos 100 metros. Apple permite 10 locales por tarjeta, así que elegí los
            que más te convenga.
          </p>
        </div>

        <button className="btn-borde" type="submit" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar aviso'}
        </button>
        {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
        {estado && 'ok' in estado && (
          <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>
            Guardado. Las tarjetas ya emitidas se actualizan solas.
          </p>
        )}
      </form>
    </details>
  );
}
