'use client';

import { useActionState, useEffect, useRef } from 'react';
import estilos from './inicio.module.css';
import { enviarSolicitudDemo, type EstadoDemo } from './acciones';
import { CAMPO_TRAMPA } from './campos';
import { LARGOS_MAXIMOS } from '@/lib/prospectos/guardarProspecto';
import { MARCA } from '@/lib/marca';

export default function FormularioDemo() {
  const [estado, accion, pendiente] = useActionState<EstadoDemo, FormData>(
    enviarSolicitudDemo,
    undefined,
  );
  const origen = useRef<HTMLInputElement>(null);

  // El origen se rellena DESPUÉS de hidratar, tocando el DOM en vez de renderizarlo: pintarlo en
  // el HTML del servidor obligaría a leer los parámetros de la URL en el render y a volver
  // dinámica una página que puede servirse estática. Sin JavaScript queda vacío, que es lo
  // correcto: es telemetría, no un dato de la persona.
  useEffect(() => {
    if (!origen.current) return;
    const parametros = new URLSearchParams(window.location.search);
    const valor = parametros.get('origen') ?? parametros.get('utm_source');
    if (valor) origen.current.value = valor;
  }, []);

  if (estado && 'ok' in estado) {
    return (
      <div className={estilos.exito} role="status">
        <span className={estilos.exitoMarca} aria-hidden="true">
          ✓
        </span>
        <h3>Listo, ya lo tenemos</h3>
        <p>
          Te escribimos en menos de un día hábil para coordinar la demo y mostrarte cómo se vería tu
          tarjeta. Si preferís adelantarte, escribinos a{' '}
          <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>.
        </p>
      </div>
    );
  }

  return (
    <form className={estilos.formulario} action={accion}>
      <div className={estilos.campo}>
        <label htmlFor="demo-nombre">Tu nombre</label>
        <input
          id="demo-nombre"
          name="nombre"
          autoComplete="name"
          maxLength={LARGOS_MAXIMOS.nombre}
          placeholder="Ana Rivera"
          required
        />
      </div>

      <div className={estilos.campo}>
        <label htmlFor="demo-negocio">Tu negocio</label>
        <input
          id="demo-negocio"
          name="negocio"
          autoComplete="organization"
          maxLength={LARGOS_MAXIMOS.negocio}
          placeholder="Café Volcán"
          required
        />
      </div>

      <div className={estilos.pareja}>
        <div className={estilos.campo}>
          <label htmlFor="demo-correo">Correo</label>
          <input
            id="demo-correo"
            name="correo"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={LARGOS_MAXIMOS.correo}
            placeholder="ana@tunegocio.com"
            // Ninguno de los dos es obligatorio por separado y HTML no sabe decir "uno de estos
            // dos": la regla la impone el servidor, y acá se la contamos a quien no ve el
            // formulario.
            aria-describedby="ayuda-contacto"
          />
        </div>
        <div className={estilos.campo}>
          <label htmlFor="demo-telefono">Teléfono o WhatsApp</label>
          <input
            id="demo-telefono"
            name="telefono"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={LARGOS_MAXIMOS.telefono}
            placeholder="7777 1234"
            aria-describedby="ayuda-contacto"
          />
        </div>
      </div>
      <p className={estilos.ayuda} id="ayuda-contacto">
        Con uno de los dos basta, pero necesitamos al menos uno para responderte.
      </p>

      <div className={estilos.campo}>
        <label htmlFor="demo-mensaje">¿Algo que querrás contarnos? (opcional)</label>
        <textarea
          id="demo-mensaje"
          name="mensaje"
          rows={3}
          maxLength={LARGOS_MAXIMOS.mensaje}
          placeholder="Tengo tres sucursales y quiero premiar a los que vuelven."
        />
      </div>

      {/* De dónde llegó el visitante. Lo pone la página, no la persona. */}
      <input ref={origen} type="hidden" name="origen" defaultValue="" />

      {/* Campo TRAMPA: escondido, fuera del tabulador y marcado como decorativo, así que ninguna
          persona ni lector de pantalla lo encuentra. Si llega con algo, el envío se responde con
          éxito y no se guarda nada. */}
      <div className={estilos.trampa} aria-hidden="true">
        <label htmlFor="demo-sitio-web">No llenés este campo</label>
        <input
          id="demo-sitio-web"
          name={CAMPO_TRAMPA}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <button className={estilos.botonPrimario} type="submit" disabled={pendiente}>
        {pendiente ? 'Enviando…' : 'Agendá tu demo'}
      </button>

      {estado && 'error' in estado && (
        <p className={estilos.alerta} role="alert">
          {estado.error}
        </p>
      )}

      <p className={estilos.ayuda}>
        Usamos estos datos solo para contactarte. Nada de listas de correo.
      </p>
    </form>
  );
}
