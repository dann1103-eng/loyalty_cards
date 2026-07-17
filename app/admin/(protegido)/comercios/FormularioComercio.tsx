'use client';

import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { ESTADOS_LICENCIA, type DatosComercio } from '@/lib/comercios/guardarComercio';

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

  return (
    <form className="panel" action={ejecutar}>
      <div className="field">
        <label htmlFor="nombre">Nombre</label>
        <input id="nombre" name="nombre" defaultValue={inicial?.nombre ?? ''} required />
      </div>
      <div className="field">
        <label htmlFor="slug">Slug (la dirección: /registro/…)</label>
        <input
          id="slug"
          name="slug"
          defaultValue={inicial?.slug ?? ''}
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
            defaultValue={inicial?.[campo] ?? 'rgb(255, 255, 255)'}
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
          <input id={campo} name={campo} defaultValue={inicial?.[campo] ?? ''} />
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
          defaultValue={inicial?.licencia_estado ?? 'activo'}
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
        <input id="licencia_plan" name="licencia_plan" defaultValue={inicial?.licencia_plan ?? ''} />
      </div>
      <div className="field">
        <label htmlFor="licencia_monto_mensual">Monto mensual (opcional)</label>
        <input
          id="licencia_monto_mensual"
          name="licencia_monto_mensual"
          type="number"
          min="0"
          step="0.01"
          defaultValue={inicial?.licencia_monto_mensual ?? ''}
        />
      </div>
      <div className="field">
        <label htmlFor="licencia_activa_desde">Activa desde (opcional)</label>
        <input
          id="licencia_activa_desde"
          name="licencia_activa_desde"
          type="date"
          defaultValue={inicial?.licencia_activa_desde ?? ''}
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
