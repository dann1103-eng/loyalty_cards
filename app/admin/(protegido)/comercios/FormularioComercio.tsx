'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { ESTADOS_LICENCIA, type DatosComercio } from '@/lib/comercios/guardarComercio';

type Valores = {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string;
  strip_url: string;
  hero_url: string;
  licencia_estado: string;
  licencia_plan: string;
  licencia_monto_mensual: string;
  licencia_activa_desde: string;
};

function valoresIniciales(inicial?: Partial<DatosComercio>): Valores {
  return {
    nombre: inicial?.nombre ?? '',
    slug: inicial?.slug ?? '',
    color_fondo: inicial?.color_fondo ?? 'rgb(255, 255, 255)',
    color_texto: inicial?.color_texto ?? 'rgb(255, 255, 255)',
    color_label: inicial?.color_label ?? 'rgb(255, 255, 255)',
    logo_url: inicial?.logo_url ?? '',
    strip_url: inicial?.strip_url ?? '',
    hero_url: inicial?.hero_url ?? '',
    licencia_estado: inicial?.licencia_estado ?? 'activo',
    licencia_plan: inicial?.licencia_plan ?? '',
    licencia_monto_mensual:
      inicial?.licencia_monto_mensual != null ? String(inicial.licencia_monto_mensual) : '',
    licencia_activa_desde: inicial?.licencia_activa_desde ?? '',
  };
}

export default function FormularioComercio({
  accion,
  inicial,
  textoBoton,
  esEdicion = false,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: Partial<DatosComercio>;
  textoBoton: string;
  esEdicion?: boolean;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoFormulario, FormData>(
    accion,
    undefined,
  );

  // Campos CONTROLADOS a propósito. React 19 resetea los campos no controlados cuando una
  // action del formulario termina —incluso si devolvió un error— así que con defaultValue el
  // admin llenaba doce campos, se equivocaba en uno, y perdía todo. Verificado en el navegador:
  // el nombre y el slug volvían a "" al rechazarse un color. Y es fácil de disparar: escribir
  // "Café Piloto" como slug (mayúscula, espacio, tilde) lo rechaza al primer intento.
  const [valores, setValores] = useState<Valores>(() => valoresIniciales(inicial));

  const cambiar =
    (campo: keyof Valores) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  return (
    <form className="panel" action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" value={valores.nombre} onChange={cambiar('nombre')} required />
      </div>
      <div className="field">
        <label htmlFor="slug">Slug (la dirección: /registro/…)</label>
        <input
          id="slug"
          name="slug"
          value={valores.slug}
          onChange={cambiar('slug')}
          placeholder="cafeteria-piloto"
          required
        />
        {esEdicion && (
          <p className="field-aviso">
            Cambiarlo rompe los QR ya impresos de este comercio: quien los escanee caerá en
            «Comercio no encontrado» y no podrá registrarse. Los passes ya emitidos siguen
            funcionando.
          </p>
        )}
      </div>

      {(
        [
          ['color_fondo', 'Color de fondo'],
          ['color_texto', 'Color de texto'],
          ['color_label', 'Color de etiqueta'],
        ] as const
      ).map(([campo, etiqueta]) => (
        <div className="field" key={campo}>
          <label htmlFor={campo}>{etiqueta}</label>
          <input
            id={campo}
            name={campo}
            value={valores[campo]}
            onChange={cambiar(campo)}
            placeholder="rgb(35, 24, 18)"
            required
          />
        </div>
      ))}

      {(
        [
          ['logo_url', 'URL del logo'],
          ['strip_url', 'URL de la franja'],
          ['hero_url', 'URL de la imagen principal'],
        ] as const
      ).map(([campo, etiqueta]) => (
        <div className="field" key={campo}>
          <label htmlFor={campo}>{etiqueta} (opcional)</label>
          <input id={campo} name={campo} value={valores[campo]} onChange={cambiar(campo)} />
        </div>
      ))}

      <div className="field">
        <label htmlFor="licencia_estado">Estado de licencia</label>
        {/* Las opciones salen de ESTADOS_LICENCIA, la MISMA constante contra la que valida
            guardarComercio.ts y que refleja el check de la BD. Hardcodearlas aquí crearía tres
            copias de una sola regla: si mañana se agrega un estado, se agrega en un solo lugar. */}
        <select
          id="licencia_estado"
          name="licencia_estado"
          value={valores.licencia_estado}
          onChange={cambiar('licencia_estado')}
        >
          {ESTADOS_LICENCIA.map((e) => (
            <option key={e} value={e}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="licencia_plan">Plan (opcional)</label>
        <input
          id="licencia_plan"
          name="licencia_plan"
          value={valores.licencia_plan}
          onChange={cambiar('licencia_plan')}
        />
      </div>
      <div className="field">
        <label htmlFor="licencia_monto_mensual">Monto mensual (opcional)</label>
        <input
          id="licencia_monto_mensual"
          name="licencia_monto_mensual"
          type="number"
          min="0"
          step="0.01"
          value={valores.licencia_monto_mensual}
          onChange={cambiar('licencia_monto_mensual')}
        />
      </div>
      <div className="field">
        <label htmlFor="licencia_activa_desde">Activa desde (opcional)</label>
        <input
          id="licencia_activa_desde"
          name="licencia_activa_desde"
          type="date"
          value={valores.licencia_activa_desde}
          onChange={cambiar('licencia_activa_desde')}
        />
      </div>

      <button className="btn-primary" type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : textoBoton}
      </button>
      {estado?.error && (
        <p className="alerta" role="alert">
          {estado.error}
        </p>
      )}
    </form>
  );
}
