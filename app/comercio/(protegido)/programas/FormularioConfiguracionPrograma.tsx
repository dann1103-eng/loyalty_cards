'use client';

import { useActionState, useState } from 'react';
import { accionGuardarConfiguracionPrograma, type EstadoPrograma } from './actions';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import type { Programa } from '@/lib/comercio/programas';
// De avisoVencimientoConfiguracion.ts y NUNCA de avisoVencimiento.ts: este es un componente de
// navegador, y aquel arrastra Apple y `googleapis` (ver el comentario del módulo).
import {
  AVISO_VENCIMIENTO_POR_TIPO,
  MAXIMO_CARACTERES_AVISO_VENCIMIENTO,
  MAXIMO_DIAS_AVISO_VENCIMIENTO,
  textoAviso,
} from '@/lib/comercio/avisoVencimientoConfiguracion';

// Mismo patrón que FormularioTipo (reglas/, ahora retirado): campos NO controlados con `key`,
// porque esto es EDICIÓN de un programa ya creado — con estado controlado el reset posterior al
// Server Action desincroniza los campos del valor real guardado. El tipo NUNCA viaja en el
// formulario: es fijo desde que se creó el programa (programa.tipoTarjeta, no un <select>).
//
// `fechaEjemplo` es la fecha con la que se arma la vista previa del aviso. Llega calculada desde el
// servidor (page.tsx) y no con un `new Date()` acá: en el navegador del dueño y en el servidor (UTC)
// "hoy" puede ser otro día, y la vista previa dibujaría textos distintos al hidratar.
export default function FormularioConfiguracionPrograma({
  programa,
  fechaEjemplo,
}: {
  programa: Programa;
  fechaEjemplo: string;
}) {
  const accion = accionGuardarConfiguracionPrograma.bind(null, programa.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(accion, undefined);

  const tipo = tipoOPuntos(programa.tipoTarjeta);
  const aTexto = (valor: number | null) => (valor === null ? '' : String(valor));

  // TODOS los campos que el formulario dibuja van en la clave, los del aviso incluidos. Tras guardar,
  // React 19 resetea el <form> nativo a los valores con los que se sirvió la página (el bug que
  // documenta FormularioBranding.tsx): sin remontarlo, la casilla del aviso o sus días volverían a
  // mostrar lo viejo aunque la base ya tenga lo nuevo, y el siguiente Guardar lo pisaría.
  const clave = [
    programa.cashbackPorcentaje,
    programa.multipassVisitas,
    programa.membresiaDias,
    programa.cuponVigenciaDias,
    programa.avisoVencimientoActivo,
    programa.avisoVencimientoDias,
    programa.avisoVencimientoMensaje,
  ].join('|');

  if (tipo.valor === 'puntos' || tipo.valor === 'sellos' || tipo.valor === 'descuento') return null;

  if (tipo.valor === 'gift_card') {
    return (
      <p className="admin-fila-slug" style={{ marginTop: 10 }}>
        La gift card no necesita configuración: el saldo lo carga el cajero al venderla. Si querés
        poner un tope por carga, usá el techo por transacción en Reglas — se lee en dólares para
        este tipo.
      </p>
    );
  }

  return (
    <form key={clave} action={ejecutar} style={{ marginTop: 10 }}>
      {tipo.valor === 'cashback' && (
        <div className="field">
          <label htmlFor={`cashback_porcentaje-${programa.id}`}>Porcentaje que vuelve como saldo</label>
          <input
            id={`cashback_porcentaje-${programa.id}`}
            name="cashback_porcentaje"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            inputMode="decimal"
            placeholder="5"
            defaultValue={aTexto(programa.cashbackPorcentaje)}
          />
        </div>
      )}

      {tipo.valor === 'prepago' && (
        <div className="field">
          <label htmlFor={`multipass_visitas-${programa.id}`}>Visitas que trae el paquete</label>
          <input
            id={`multipass_visitas-${programa.id}`}
            name="multipass_visitas"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="10"
            defaultValue={aTexto(programa.multipassVisitas)}
          />
        </div>
      )}

      {tipo.valor === 'membresia' && (
        <div className="field">
          <label htmlFor={`membresia_dias-${programa.id}`}>Días que dura cada renovación</label>
          <input
            id={`membresia_dias-${programa.id}`}
            name="membresia_dias"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="30"
            defaultValue={aTexto(programa.membresiaDias)}
          />
        </div>
      )}

      {tipo.valor === 'cupon' && (
        <div className="field">
          <label htmlFor={`cupon_vigencia_dias-${programa.id}`}>Días que vale el cupón (opcional)</label>
          <input
            id={`cupon_vigencia_dias-${programa.id}`}
            name="cupon_vigencia_dias"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="Sin vencimiento"
            defaultValue={aTexto(programa.cuponVigenciaDias)}
          />
        </div>
      )}

      {/* Por `usaVigencia` y no por nombre de tipo: el aviso es de lo que VENCE, y un tipo nuevo con
          fecha lo recibe solo. En los demás tipos el bloque no se dibuja y sus tres campos no
          viajan: la acción guarda el aviso apagado y en null, que es como nace en esos tipos (ver
          el comentario del update en guardarConfiguracionPrograma). */}
      {tipo.usaVigencia && (
        <BloqueAvisoVencimiento programa={programa} fechaEjemplo={fechaEjemplo} />
      )}

      <button className="btn-borde" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar configuración'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'ok' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>Guardado.</p>
      )}
    </form>
  );
}

// El aviso antes del vencimiento: vive DENTRO del formulario de configuración, no en uno propio. Un
// segundo <form> sería un segundo escritor, y guardarConfiguracionPrograma escribe las columnas del
// aviso en cada guardado: el que guardara último pisaría al otro.
//
// Los tres campos se dibujan SIEMPRE, con la casilla apagada también, y nunca `disabled`: un campo
// deshabilitado no viaja en el envío, y apagar el aviso le borraría al dueño los días y el mensaje
// que ya había escrito.
//
// El único estado de cliente es el texto del mensaje, para la vista previa. Es un <textarea>
// controlado a propósito, y no uno con `defaultValue` más un espejo en el estado: React le
// sincroniza el valor por defecto a un campo controlado, así que el reset nativo del <form> tras
// guardar lo deja en lo que el dueño escribió y la vista previa nunca se despega del campo. La
// casilla y los días quedan no controlados como el resto del formulario: la vista previa no los usa.
function BloqueAvisoVencimiento({ programa, fechaEjemplo }: { programa: Programa; fechaEjemplo: string }) {
  const [mensaje, setMensaje] = useState(programa.avisoVencimientoMensaje ?? '');
  const id = (campo: string) => `${campo}-${programa.id}`;

  return (
    <div style={{ borderTop: '1px solid var(--linea)', paddingTop: 16, marginTop: 4, marginBottom: 8 }}>
      <p className="titulo-seccion" style={{ marginBottom: 6 }}>Aviso antes del vencimiento</p>
      <p className="admin-fila-slug" style={{ marginTop: 0, marginBottom: 14 }}>
        Le llega un mensaje al teléfono del cliente unos días antes de que se le venza.
      </p>

      <div className="field">
        <label htmlFor={id('aviso_vencimiento_activo')} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            id={id('aviso_vencimiento_activo')}
            name="aviso_vencimiento_activo"
            type="checkbox"
            defaultChecked={programa.avisoVencimientoActivo}
          />
          Mandar el aviso
        </label>
      </div>

      <div className="field">
        <label htmlFor={id('aviso_vencimiento_dias')}>Cuántos días antes de que venza</label>
        <input
          id={id('aviso_vencimiento_dias')}
          name="aviso_vencimiento_dias"
          type="number"
          min="1"
          max={MAXIMO_DIAS_AVISO_VENCIMIENTO}
          step="1"
          inputMode="numeric"
          placeholder="3"
          defaultValue={programa.avisoVencimientoDias === null ? '' : String(programa.avisoVencimientoDias)}
        />
      </div>

      <div className="field">
        <label htmlFor={id('aviso_vencimiento_mensaje')}>Mensaje (opcional)</label>
        <textarea
          id={id('aviso_vencimiento_mensaje')}
          name="aviso_vencimiento_mensaje"
          rows={3}
          maxLength={MAXIMO_CARACTERES_AVISO_VENCIMIENTO}
          placeholder={AVISO_VENCIMIENTO_POR_TIPO[programa.tipoTarjeta]}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
        <p className="admin-fila-slug" style={{ marginTop: 0 }}>
          No escribás la fecha: la app la agrega sola, con la de cada cliente. Si lo dejás vacío, se
          manda un mensaje ya escrito.
        </p>
      </div>

      {/* La vista previa usa `textoAviso`, la MISMA función con la que el cron arma el mensaje que
          se envía: si la regla de la fecha o del texto por defecto cambia, esto cambia con ella. */}
      <div
        aria-live="polite"
        className="pozo"
        style={{ marginBottom: 16 }}
      >
        <p className="admin-fila-slug" style={{ margin: 0 }}>Así le llega al cliente:</p>
        <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>{textoAviso(mensaje, programa.tipoTarjeta, fechaEjemplo)}</p>
        <p className="admin-fila-slug" style={{ margin: '6px 0 0' }}>
          La fecha es de ejemplo. Cada cliente ve la suya.
        </p>
      </div>
    </div>
  );
}
