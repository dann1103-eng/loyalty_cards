'use client';

import { useActionState } from 'react';
import { accionGuardarConfiguracionTipo, type EstadoConfiguracionTipo } from './actions';
import type { ConfiguracionTipo } from '@/lib/comercio/configuracionTipo';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';

// La configuración propia del tipo de tarjeta del comercio. Se muestra SOLO el campo que aplica:
// un comercio de sellos no tiene por qué ver "porcentaje de cashback", y ofrecérselo lo haría dudar
// de si le falta configurar algo.
//
// Campos NO controlados con `key`, igual que FormularioControles: es de EDICIÓN, y con estado
// controlado el reset posterior al Server Action desincroniza los campos.

export default function FormularioTipo({ configuracion }: { configuracion: ConfiguracionTipo }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoConfiguracionTipo, FormData>(
    accionGuardarConfiguracionTipo,
    undefined,
  );

  const tipo = tipoOPuntos(configuracion.tipoTarjeta);
  const aTexto = (valor: number | null) => (valor === null ? '' : String(valor));

  const clave = [
    configuracion.cashbackPorcentaje,
    configuracion.multipassVisitas,
    configuracion.membresiaDias,
    configuracion.cuponVigenciaDias,
  ].join('|');

  // Puntos y sellos no tienen configuración propia acá: la meta de sellos vive en Marca, junto al
  // ícono con el que se dibuja la grilla. Mostrar un panel vacío sería peor que no mostrarlo.
  const sinConfiguracion = tipo.valor === 'puntos' || tipo.valor === 'sellos' || tipo.valor === 'descuento';
  if (sinConfiguracion) return null;

  return (
    <form key={clave} className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Configuración de {tipo.etiqueta}</h2>
      <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 18 }}>
        {tipo.descripcion}
      </p>

      {tipo.valor === 'cashback' && (
        <div className="field">
          <label htmlFor="cashback_porcentaje">Porcentaje que vuelve como saldo</label>
          <input
            id="cashback_porcentaje"
            name="cashback_porcentaje"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            inputMode="decimal"
            placeholder="5"
            defaultValue={aTexto(configuracion.cashbackPorcentaje)}
          />
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Con 5%, una compra de $19.99 le devuelve $1.00. El redondeo va a favor del cliente.
          </p>
        </div>
      )}

      {tipo.valor === 'prepago' && (
        <div className="field">
          <label htmlFor="multipass_visitas">Visitas que trae el paquete</label>
          <input
            id="multipass_visitas"
            name="multipass_visitas"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="10"
            defaultValue={aTexto(configuracion.multipassVisitas)}
          />
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Al vender un paquete se le SUMAN a las que ya tenía, no lo reemplazan.
          </p>
        </div>
      )}

      {tipo.valor === 'membresia' && (
        <div className="field">
          <label htmlFor="membresia_dias">Días que dura cada renovación</label>
          <input
            id="membresia_dias"
            name="membresia_dias"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="30"
            defaultValue={aTexto(configuracion.membresiaDias)}
          />
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Renovar antes de vencer suma sobre lo que le quedaba: no pierde días que ya pagó.
          </p>
        </div>
      )}

      {tipo.valor === 'cupon' && (
        <div className="field">
          <label htmlFor="cupon_vigencia_dias">Días que vale el cupón desde que se registra</label>
          <input
            id="cupon_vigencia_dias"
            name="cupon_vigencia_dias"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            placeholder="Sin vencimiento"
            defaultValue={aTexto(configuracion.cuponVigenciaDias)}
          />
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Dejalo vacío para que no venza nunca. El día del vencimiento el cupón todavía se puede usar.
          </p>
        </div>
      )}

      {tipo.valor === 'gift_card' && (
        <p className="admin-fila-slug">
          La gift card no necesita configuración: el saldo lo carga el cajero al venderla. Si querés
          poner un tope por carga, usá el techo por transacción del panel de arriba — se lee en
          dólares para este tipo.
        </p>
      )}

      {tipo.valor !== 'gift_card' && (
        <button className="btn-primary" type="submit" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar configuración'}
        </button>
      )}
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
      {estado && 'ok' in estado && (
        <p className="admin-fila-slug" role="status" style={{ marginTop: 10 }}>Configuración guardada.</p>
      )}
    </form>
  );
}
