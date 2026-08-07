'use client';

import { useActionState, useState } from 'react';
import { accionRegistrarComercio, type EstadoRegistro } from './actions';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';
import { PLANES } from '@/lib/comercios/cuentas';
import { LARGO_MINIMO_CLAVE } from '@/lib/comercios/altaAutoservicio';

// El formulario de alta. La vara de diseño es explícita: alguien de 50 años, solo, sin que nadie le
// explique nada. De ahí tres decisiones:
//
// 1. CUATRO decisiones, no diez. Nombre, correo, clave, plan y tipo — nada más. El slug, los
//    colores, la sucursal y el programa los arma el sistema; el dueño los cambia después si quiere.
// 2. El tipo de tarjeta es UN SOLO control con la descripción del elegido debajo, no ocho tarjetas
//    compitiendo. Arranca en "Sellos" porque es el que todo el mundo ya conoce de la cafetería de
//    la esquina.
// 3. Cada campo dice para qué sirve ANTES de que lo llenen, no después de que se equivoquen.
//
// Campos NO controlados salvo los dos que dibujan algo en pantalla (tipo y plan): es un formulario
// de ALTA de una sola pasada, y controlar todo solo agrega estado que se puede desincronizar.

const TIPO_POR_DEFECTO = 'sellos';

export default function FormularioRegistro({ planInicial }: { planInicial?: string }) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoRegistro, FormData>(
    accionRegistrarComercio,
    undefined,
  );
  const [tipo, setTipo] = useState<string>(TIPO_POR_DEFECTO);
  // `planInicial` viene de la URL (la tabla de precios de la portada). Se valida contra el catálogo
  // acá y no se confía tal cual: un `?plan=` inventado dejaría el grupo de radios SIN ninguno
  // marcado, y el alta fallaría con "elegí un plan" sobre un formulario que se ve completo.
  const [plan, setPlan] = useState<string>(
    PLANES.some((p) => p.valor === planInicial) ? planInicial! : 'starter',
  );

  const tipoElegido = TIPOS_TARJETA.find((t) => t.valor === tipo);

  return (
    <form action={ejecutar} className="panel" style={{ marginTop: 0, textAlign: 'left' }}>
      <div className="field">
        <label htmlFor="nombre">¿Cómo se llama tu negocio?</label>
        <input
          id="nombre"
          name="nombre"
          type="text"
          required
          maxLength={80}
          autoComplete="organization"
          placeholder="Cafetería La Esquina"
        />
        <p className="nota" style={{ marginTop: 6 }}>
          Es el nombre que van a ver tus clientes en su tarjeta.
        </p>
      </div>

      <div className="field">
        <label htmlFor="email">Tu correo</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="vos@tunegocio.com"
        />
        <p className="nota" style={{ marginTop: 6 }}>
          Con este correo vas a entrar a tu panel.
        </p>
      </div>

      <div className="field">
        <label htmlFor="password">Elegí una contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={LARGO_MINIMO_CLAVE}
          autoComplete="new-password"
          placeholder={`Al menos ${LARGO_MINIMO_CLAVE} caracteres`}
        />
        <p className="nota" style={{ marginTop: 6 }}>
          Nadie más la ve, ni nosotros. Anotala en algún lado seguro.
        </p>
      </div>

      <div className="field">
        <label htmlFor="tipo_tarjeta">¿Cómo querés premiar a tus clientes?</label>
        <select
          id="tipo_tarjeta"
          name="tipo_tarjeta"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          {TIPOS_TARJETA.filter((t) => t.disponible).map((t) => (
            <option key={t.valor} value={t.valor}>{t.etiqueta}</option>
          ))}
        </select>
        {/* La descripción del tipo ELEGIDO, no las ocho a la vez: el que está decidiendo solo
            necesita entender la que está mirando. */}
        {tipoElegido && (
          <p className="nota" style={{ marginTop: 6 }}>{tipoElegido.descripcion}</p>
        )}
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 16px' }}>
        <legend className="titulo-seccion" style={{ marginBottom: 8 }}>Elegí tu plan</legend>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PLANES.map((p) => (
            <label
              key={p.valor}
              htmlFor={`plan-${p.valor}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 12,
                cursor: 'pointer',
                border: `1px solid ${plan === p.valor ? 'var(--acento)' : 'var(--linea)'}`,
                background: plan === p.valor ? 'var(--superficie-1)' : 'transparent',
              }}
            >
              <input
                id={`plan-${p.valor}`}
                type="radio"
                name="plan"
                value={p.valor}
                checked={plan === p.valor}
                onChange={() => setPlan(p.valor)}
                style={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="admin-fila-nombre">{p.etiqueta}</span>
                <span className="admin-fila-slug" style={{ display: 'block' }}>
                  {p.limiteSugerido === null
                    ? 'Negocios y sucursales sin límite'
                    : p.limiteSugerido === 1
                      ? '1 negocio o sucursal'
                      : `Hasta ${p.limiteSugerido} negocios o sucursales`}
                </span>
              </span>
              <span className="dato-mono" style={{ flexShrink: 0 }}>${p.montoMensual}/mes</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Honestidad sobre el cobro: la cuenta nace SIN licencia activa y el pago se coordina aparte
          (todavía no hay pasarela). Decirlo acá evita que alguien crea que ya le cobramos. */}
      <p className="nota" style={{ marginTop: 0 }}>
        No te pedimos tarjeta ahora. Creás tu cuenta, la probás, y coordinamos el pago con vos.
      </p>

      <button className="btn-primary" type="submit" disabled={pendiente} style={{ marginTop: 14, width: '100%' }}>
        {pendiente ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
      </button>

      {estado && 'error' in estado && (
        <p className="alerta" role="alert" style={{ marginTop: 12 }}>{estado.error}</p>
      )}
    </form>
  );
}
