'use client';

import { useActionState, useState } from 'react';
import { accionCrearPrograma, type EstadoPrograma } from './actions';
import { TIPOS } from '@/lib/tarjetas/tipos';

// A diferencia de FormularioConfiguracionPrograma (edición, tipo fijo), acá el tipo se elige en el
// momento — hace falta estado de cliente para saber qué campo de configuración mostrar. Es un
// formulario de CREACIÓN: los campos son no controlados salvo el <select> de tipo, así que el
// reset nativo tras el Server Action los deja listos para cargar otro programa.
export default function FormularioNuevoPrograma() {
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(accionCrearPrograma, undefined);
  // 'cupon' y no 'puntos' (el default más común del principal): quien llega a este formulario ya
  // tiene un programa, así que un SEGUNDO puntos/sellos suele ser un error de click. El caso de uso
  // típico de la spec es "sellos permanente + cupón de campaña".
  const [tipoTarjeta, setTipoTarjeta] = useState('cupon');

  const tipo = TIPOS.find((t) => t.valor === tipoTarjeta);

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <h2 className="subtitle" style={{ marginTop: 0 }}>Crear un programa nuevo</h2>

      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" placeholder="Cupón de bienvenida" required />
      </div>

      <div className="field">
        <label htmlFor="tipo_tarjeta">Tipo de tarjeta</label>
        <select
          id="tipo_tarjeta"
          name="tipo_tarjeta"
          value={tipoTarjeta}
          onChange={(e) => setTipoTarjeta(e.target.value)}
        >
          {/* 'descuento' no se ofrece acá: sus niveles (niveles_descuento) todavía son por comercio,
              no por programa — un segundo programa de descuento sería indistinguible del primero. */}
          {TIPOS.filter((t) => t.valor !== 'descuento').map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
        {tipo && (
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>{tipo.descripcion}</p>
        )}
      </div>

      {tipoTarjeta === 'cashback' && (
        <div className="field">
          <label htmlFor="cashback_porcentaje">Porcentaje que vuelve como saldo</label>
          <input
            id="cashback_porcentaje" name="cashback_porcentaje" type="number"
            min="0.01" max="100" step="0.01" inputMode="decimal" placeholder="5" required
          />
        </div>
      )}

      {tipoTarjeta === 'prepago' && (
        <div className="field">
          <label htmlFor="multipass_visitas">Visitas que trae el paquete</label>
          <input
            id="multipass_visitas" name="multipass_visitas" type="number"
            min="1" step="1" inputMode="numeric" placeholder="10" required
          />
        </div>
      )}

      {tipoTarjeta === 'membresia' && (
        <div className="field">
          <label htmlFor="membresia_dias">Días que dura cada renovación</label>
          <input
            id="membresia_dias" name="membresia_dias" type="number"
            min="1" step="1" inputMode="numeric" placeholder="30" required
          />
        </div>
      )}

      {tipoTarjeta === 'cupon' && (
        <div className="field">
          <label htmlFor="cupon_vigencia_dias">Días que vale el cupón (opcional)</label>
          <input
            id="cupon_vigencia_dias" name="cupon_vigencia_dias" type="number"
            min="1" step="1" inputMode="numeric" placeholder="Sin vencimiento"
          />
        </div>
      )}

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Creando…' : 'Crear programa'}
      </button>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
