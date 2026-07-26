'use client';

import { useState, useRef, useEffect, type ChangeEvent, type CSSProperties } from 'react';
import { useActionState } from 'react';
import { accionGuardarReverso, type EstadoBranding } from './actions';

type ClaveEnlace = 'red_instagram' | 'red_facebook' | 'red_whatsapp' | 'sitio_web';
type ClaveTexto = ClaveEnlace | 'terminos_uso';

type Props = {
  nombreComercio: string;
  esSellos: boolean;
  inicial: {
    terminos_uso: string;
    red_instagram: string;
    red_facebook: string;
    red_whatsapp: string;
    sitio_web: string;
    mostrar_como_funciona: boolean;
  };
};

/* Etiqueta, ejemplo y ayuda de cada enlace viajan juntos: agregar una red y olvidarse de su ejemplo
   deja de ser posible. El orden es el mismo en que salen en el reverso del pass (spec §3). */
const CAMPOS_ENLACE: { campo: ClaveEnlace; etiqueta: string; ejemplo: string; ayuda?: string }[] = [
  { campo: 'red_instagram', etiqueta: 'Instagram', ejemplo: 'https://instagram.com/tunegocio' },
  { campo: 'red_facebook', etiqueta: 'Facebook', ejemplo: 'https://facebook.com/tunegocio' },
  {
    campo: 'red_whatsapp',
    etiqueta: 'WhatsApp',
    ejemplo: 'https://wa.me/50370001234',
    // El dueño piensa en su número, no en un enlace; sin esta línea escribe "7000-1234" y el campo
    // se lo rechaza sin decirle qué se esperaba.
    ayuda: 'Va el enlace, no el número: wa.me seguido de tu número con el 503 adelante.',
  },
  { campo: 'sitio_web', etiqueta: 'Sitio web', ejemplo: 'https://tunegocio.com' },
];

/* Texto literal del spec §8.2. Vive acá tal cual y no "a criterio del implementador" porque es texto
   cuasi-legal que termina en la tarjeta de cada cliente. Deliberadamente NO repite cómo se ganan
   {unidad} ni qué se canjea: de eso ya se encarga la sección automática, y duplicarlo es justo lo
   que se desactualiza. */
function borradorTerminos(unidad: string, comercio: string): string {
  return [
    `1. Los ${unidad} no tienen valor monetario y no se canjean por efectivo.`,
    `2. Los ${unidad} no vencen.`,
    '3. La tarjeta es personal: no se transfiere ni se combina con otras.',
    '4. Las recompensas están sujetas a disponibilidad.',
    '5. No acumulable con otras promociones.',
    `6. ${comercio} puede modificar o terminar el programa avisando en el local.`,
  ].join('\n');
}

export default function FormularioReverso({ nombreComercio, esSellos, inicial }: Props) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionGuardarReverso,
    undefined,
  );

  // Controlado, igual que el editor de colores: el botón del borrador tiene que poder escribir en el
  // textarea, y con `value` React mantiene al día el valor por defecto de cada campo, así que el
  // reset que React 19 le hace al <form> nativo tras el submit los deja como estaban (verificado en
  // react-dom: updateInput y updateTextarea sincronizan el defaultValue con el valor controlado).
  const [valores, setValores] = useState({
    terminos_uso: inicial.terminos_uso,
    red_instagram: inicial.red_instagram,
    red_facebook: inicial.red_facebook,
    red_whatsapp: inicial.red_whatsapp,
    sitio_web: inicial.sitio_web,
  });
  const [mostrarComoFunciona, setMostrarComoFunciona] = useState(inicial.mostrar_como_funciona);

  // Mismo bug de React 19 + Server Actions que el <select> del editor de colores, y acá NO es
  // cosmético. Comprobado en el React instalado (react-dom-client.development.js):
  // `recursivelyResetForms` corre al FINAL del commit, después de escribir el DOM, así que el
  // form.reset() tiene la última palabra; `initInput` fija `defaultChecked` con el valor de montaje
  // y `updateInput` solo lo re-sincroniza cuando el checkbox NO es controlado. Resultado sin este
  // remonte: el dueño desmarca la sección, guarda bien, el checkbox vuelve a verse marcado y el
  // siguiente Guardar la vuelve a encender. Los inputs de texto y el textarea no lo sufren porque de
  // esos React sí mantiene al día el defaultValue.
  const [claveCheckbox, setClaveCheckbox] = useState(0);
  const pendienteAnteriorRef = useRef(false);
  useEffect(() => {
    if (pendienteAnteriorRef.current && !pendiente && estado && 'ok' in estado) {
      setClaveCheckbox((n) => n + 1);
    }
    pendienteAnteriorRef.current = pendiente;
  }, [pendiente, estado]);

  const cambiarTexto =
    (campo: ClaveTexto) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  const unidad = esSellos ? 'sellos' : 'puntos';

  // El borrador se inserta con un BOTÓN y NUNCA como defaultValue del textarea (spec §8.1):
  // precargado, el dueño que solo venía a cargar su Instagram aprieta Guardar, el borrador viaja en
  // el FormData y queda persistido como los términos legales de su comercio sin que nadie los haya
  // leído. Escribirlos tiene que ser un acto explícito.
  const insertarBorrador = () => {
    // Pisar lo que el dueño ya escribió sí es destructivo, y en un teléfono este botón queda a un
    // toque de distancia del textarea.
    if (
      valores.terminos_uso.trim() !== '' &&
      !window.confirm('Esto reemplaza los términos que ya escribiste. ¿Seguir?')
    ) {
      return;
    }
    setValores((v) => ({ ...v, terminos_uso: borradorTerminos(unidad, nombreComercio) }));
  };

  // globals.css estiliza `.field input` y `.field select`, pero no tiene regla para textarea y este
  // trabajo no toca la hoja de estilos: el textarea trae su propio estilo, anillo de foco incluido
  // (sin él sería el del navegador y desentonaría con el resto del formulario).
  const [textareaEnfocado, setTextareaEnfocado] = useState(false);
  const estiloTextarea: CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: '1rem',
    lineHeight: 1.55,
    color: 'var(--texto)',
    width: '100%',
    padding: '13px 14px',
    borderRadius: 'var(--radius-field)',
    resize: 'vertical',
    outline: 'none',
    transition: 'border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease',
    background: textareaEnfocado ? 'var(--superficie-2)' : 'var(--superficie-1)',
    border: `1px solid ${textareaEnfocado ? 'var(--acento)' : 'var(--linea)'}`,
    boxShadow: textareaEnfocado ? 'var(--ring)' : 'none',
  };

  return (
    <form className="panel reveal d4" action={ejecutar}>
      <p className="titulo-seccion" style={{ marginBottom: 8 }}>Reverso de la tarjeta</p>
      <p className="lede" style={{ marginBottom: 20, fontSize: '0.9rem' }}>
        Lo que ve tu cliente cuando toca la &quot;i&quot; de su tarjeta en la billetera. Todo lo que
        dejes vacío simplemente no aparece.
      </p>

      {/* Fuera de `.field` a propósito: la regla `.field input` le pone padding, fondo y borde de
          caja de texto a TODO input, y a un checkbox nativo eso lo deforma. */}
      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="mostrar_como_funciona"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontSize: '0.95rem',
            lineHeight: 1.4,
            color: 'var(--texto)',
            cursor: 'pointer',
          }}
        >
          <input
            key={claveCheckbox}
            id="mostrar_como_funciona"
            name="mostrar_como_funciona"
            type="checkbox"
            checked={mostrarComoFunciona}
            onChange={(e) => setMostrarComoFunciona(e.target.checked)}
            style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: 'var(--acento-fuerte)' }}
          />
          <span>Mostrar la sección &quot;Cómo funciona&quot;</span>
        </label>
        <p className="field-aviso" style={{ color: 'var(--texto-2)', marginTop: 8 }}>
          La arma el sistema con tus reglas y tus recompensas activas, y se mantiene al día sola: si
          subís el costo de una recompensa, el reverso de las tarjetas ya emitidas se corrige. Si
          todavía no cargaste reglas ni recompensas, la sección no aparece.
        </p>
      </div>

      <div className="field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <label htmlFor="terminos_uso">Términos de uso</label>
          {/* type="button" NO es opcional: dentro de un <form> un botón sin type es submit, y este
              enviaría el formulario en vez de llenar el textarea. */}
          <button
            type="button"
            className="btn-borde"
            onClick={insertarBorrador}
            style={{ fontSize: '0.78rem', padding: '7px 13px' }}
          >
            Usar un borrador sugerido
          </button>
        </div>
        <textarea
          id="terminos_uso"
          name="terminos_uso"
          rows={8}
          value={valores.terminos_uso}
          onChange={cambiarTexto('terminos_uso')}
          onFocus={() => setTextareaEnfocado(true)}
          onBlur={() => setTextareaEnfocado(false)}
          placeholder="Opcional. Escribí las condiciones de tu programa, o partí del borrador sugerido."
          style={estiloTextarea}
        />
        <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
          El borrador es un punto de partida, no un contrato revisado: leelo y ajustalo antes de
          publicar. Lo que quede acá lo dice tu comercio.
        </p>
      </div>

      {CAMPOS_ENLACE.map(({ campo, etiqueta, ejemplo, ayuda }) => (
        <div className="field" key={campo}>
          <label htmlFor={campo}>{etiqueta}</label>
          <input
            id={campo}
            name={campo}
            type="url"
            inputMode="url"
            // El teclado del teléfono capitaliza y autocorrige por defecto: "Https://Instagram…"
            // pasaría la validación del navegador y fallaría la nuestra, que exige https:// exacto.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={valores[campo]}
            onChange={cambiarTexto(campo)}
            placeholder={ejemplo}
          />
          {ayuda && (
            <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>{ayuda}</p>
          )}
        </div>
      ))}

      <button className="btn-acento" type="submit" disabled={pendiente} style={{ marginTop: 6 }}>
        <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">check_circle</span>
        {pendiente ? 'Guardando…' : 'Guardar reverso'}
      </button>
      {estado && 'error' in estado && (
        <p className="alerta" role="alert">{estado.error}</p>
      )}
      {estado && 'ok' in estado && (
        <p className="nota" style={{ textAlign: 'left' }}>
          Reverso guardado. Las tarjetas que ya están en la billetera de tus clientes se actualizan
          solas.
        </p>
      )}
    </form>
  );
}
