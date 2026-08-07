'use client';

import { useActionState, useState } from 'react';
import { accionCrearRegla, type EstadoRegla } from './actions';
import { TIPOS_REGLA } from '@/lib/comercio/reglas';
import type { Unidad } from '@/lib/tarjetas/unidadPrograma';

// La regla que define cuánto gana el cliente.
//
// Antes este formulario tenía dos problemas que se sumaban. La etiqueta del valor decía
// "Valor (puntos por visita, o puntos por cada $1 de compra)": metía los DOS significados en un
// solo texto porque el campo es compartido, así que el dueño tenía que darse cuenta solo de cuál le
// aplicaba. Y decía "puntos" aunque su programa fuera de sellos.
//
// Ahora la etiqueta cambia con el tipo elegido y usa la palabra de SU programa. `unidad` es null en
// los tipos que no cuentan enteros; en esos casos estas reglas no aplican y la pantalla ni siquiera
// muestra el formulario (ver page.tsx).
export default function FormularioRegla({ unidad }: { unidad: Unidad }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoRegla, FormData>(accionCrearRegla, undefined);
  const [tipo, setTipo] = useState('por_visita');

  const etiquetaValor =
    tipo === 'por_monto'
      ? `¿Cuántos ${unidad.plural} por cada $1 de compra?`
      : `¿Cuántos ${unidad.plural} por cada visita?`;

  return (
    <form className="panel" style={{ marginTop: 0 }} action={ejecutar}>
      <div className="field">
        <label htmlFor="tipo">¿Cuándo gana el cliente?</label>
        <select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_REGLA.map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="valor">{etiquetaValor}</label>
        <input id="valor" name="valor" type="number" min="0.01" step="0.01" required />
        <p className="nota" style={{ marginTop: 6 }}>
          Esto se imprime en el reverso de la tarjeta de tus clientes, para que sepan cómo ganan. El
          cajero igual escribe la cantidad al escanear: la regla no la calcula sola.
        </p>
      </div>
      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Agregando…' : 'Agregar regla'}
      </button>
      {estado?.error && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
