'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { ESTADOS_LICENCIA, TIPOS_TARJETA, type DatosComercio } from '@/lib/comercios/guardarComercio';

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
  tipo_tarjeta: string;
  cuenta_id: string;
};

function valoresIniciales(inicial?: Partial<DatosComercio>, cuentas: { id: string }[] = []): Valores {
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
    tipo_tarjeta: inicial?.tipo_tarjeta ?? 'puntos',
    // Al crear (sin inicial) se preselecciona la primera cuenta para que el <select> nunca envíe ''
    // — validar() exige cuenta_id, y un dropdown vacío sería un rechazo garantizado en el primer
    // intento. Al editar, se respeta el cuenta_id del comercio.
    cuenta_id: inicial?.cuenta_id ?? cuentas[0]?.id ?? '',
  };
}

export default function FormularioComercio({
  accion,
  inicial,
  textoBoton,
  cuentas,
  esEdicion = false,
}: {
  accion: (estado: EstadoFormulario, formData: FormData) => Promise<EstadoFormulario>;
  inicial?: Partial<DatosComercio>;
  textoBoton: string;
  cuentas: { id: string; nombre: string }[];
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
  const [valores, setValores] = useState<Valores>(() => valoresIniciales(inicial, cuentas));

  const cambiar =
    (campo: keyof Valores) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  const esSellos = valores.tipo_tarjeta === 'sellos';

  return (
    <>
      {/* Vista previa EN VIVO: los campos son controlados, así que la tarjeta reacciona al tipeo.
          Un valor de color a medio escribir es inválido en CSS y el navegador simplemente lo
          ignora (conserva el anterior) — no hace falta validar aquí. */}
      <div className="cardface reveal d2" style={{ background: valores.color_fondo, color: valores.color_texto, maxWidth: 360, margin: '0 auto 22px' }}>
        <div className="cardface-top" style={{ color: valores.color_label }}>
          <span>Comercio afiliado</span>
          <span>FM Lealtad</span>
        </div>
        <div className="cardface-name">{valores.nombre || 'Nombre del comercio'}</div>
        <div className="cardface-points">
          <b>{esSellos ? '0 de 10' : '0'}</b>
          <span style={{ color: valores.color_label }}>{esSellos ? 'sellos' : 'Puntos'}</span>
        </div>
      </div>

      <form className="panel" action={ejecutar} style={{ marginTop: 0 }}>
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

      <div className="field">
        <label htmlFor="cuenta_id">Cuenta (cliente que paga)</label>
        {/* El límite de negocios por cuenta se aplica en validar()/verificarLimiteCuenta al guardar,
            no aquí: este <select> solo elige la cuenta. Si no hay cuentas todavía, hay que crear una
            en «Cuentas» antes de poder dar de alta un comercio. */}
        <select
          id="cuenta_id"
          name="cuenta_id"
          value={valores.cuenta_id}
          onChange={cambiar('cuenta_id')}
          required
        >
          {cuentas.length === 0 && <option value="">— No hay cuentas —</option>}
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {cuentas.length === 0 && (
          <p className="field-aviso">
            No hay cuentas todavía. Creá una en «Cuentas» antes de dar de alta un comercio.
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
        <label htmlFor="tipo_tarjeta">Tipo de tarjeta</label>
        {/* Opciones desde TIPOS_TARJETA (misma constante que valida guardarComercio). Los tipos
            no disponibles se muestran deshabilitados con "(Próximamente)" — honestos sobre cuáles
            funcionan hoy, a diferencia de Cardly que muestra los 8 como si todos funcionaran. */}
        <select
          id="tipo_tarjeta"
          name="tipo_tarjeta"
          value={valores.tipo_tarjeta}
          onChange={cambiar('tipo_tarjeta')}
        >
          {TIPOS_TARJETA.map((t) => (
            <option key={t.valor} value={t.valor} disabled={!t.disponible}>
              {t.etiqueta}
              {t.disponible ? '' : ' (Próximamente)'}
            </option>
          ))}
        </select>
      </div>
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
    </>
  );
}
