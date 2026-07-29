'use client';

import { useActionState } from 'react';
import { accionGuardarConfiguracionPrograma, type EstadoPrograma } from './actions';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import type { Programa } from '@/lib/comercio/programas';

// Mismo patrón que FormularioTipo (reglas/, ahora retirado): campos NO controlados con `key`,
// porque esto es EDICIÓN de un programa ya creado — con estado controlado el reset posterior al
// Server Action desincroniza los campos del valor real guardado. El tipo NUNCA viaja en el
// formulario: es fijo desde que se creó el programa (programa.tipoTarjeta, no un <select>).
export default function FormularioConfiguracionPrograma({ programa }: { programa: Programa }) {
  const accion = accionGuardarConfiguracionPrograma.bind(null, programa.id);
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(accion, undefined);

  const tipo = tipoOPuntos(programa.tipoTarjeta);
  const aTexto = (valor: number | null) => (valor === null ? '' : String(valor));

  const clave = [
    programa.cashbackPorcentaje,
    programa.multipassVisitas,
    programa.membresiaDias,
    programa.cuponVigenciaDias,
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
