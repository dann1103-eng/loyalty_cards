'use client';

import { useState, useRef, useEffect, type ChangeEvent, type ReactNode } from 'react';
import { useActionState } from 'react';
import {
  accionGuardarBranding,
  accionGuardarBrandingDePrograma,
  accionUsarDisenoDelNegocio,
  type EstadoBranding,
} from './actions';
import { NIVELES_DIFUMINADO, stopsDifuminado, type NivelDifuminado } from '@/lib/apple/difuminadoFranja';

const ETIQUETAS_DIFUMINADO: Record<NivelDifuminado, string> = {
  ninguno: 'Ninguno (corte seco)',
  sutil: 'Sutil',
  medio: 'Medio',
  fuerte: 'Fuerte',
};

// El único campo de ESTE formulario que crea la tarjeta del programa en Google Wallet (los otros
// dos son el logo y la imagen de portada, que se suben en SubidaImagen). Corto y llano a propósito:
// el aviso anterior era un párrafo alarmante arriba de toda la pantalla, y aparecía también en los
// campos reversibles.
const AVISO_GOOGLE = 'Esto crea la tarjeta de este programa en Google Wallet y no se puede deshacer.';

type Colores = {
  color_fondo: string;
  color_texto: string;
  color_label: string;
  difuminado_franja: string;
};

type Props = {
  nombreComercio: string;
  esSellos: boolean;
  /* null = se está diseñando la marca del NEGOCIO (la base que heredan todas las tarjetas). Con id,
     el diseño de esa tarjeta sola. Es la única diferencia entre los dos modos de esta pantalla. */
  programaId: string | null;
  /* Cómo se llama lo que se está diseñando, para los textos: el comercio o el programa. */
  nombreTarjeta: string;
  inicial: Colores & { sello_meta: string };
  /* Lo que esta tarjeta toma del negocio en cada campo que quede vacío. null en modo negocio, donde
     no hay de quién heredar. Se muestra como placeholder gris: el dueño VE qué está usando hoy en
     vez de una caja vacía que no le dice si hereda o si no hay nada configurado. */
  heredado: Colores | null;
  /* Si esta tarjeta usa hoy su propio diseño. Solo decide qué se le MUESTRA al dueño (el botón de
     volver al diseño del negocio y el aviso de estado): el booleano de la base no se edita a mano
     nunca, se deriva de lo que el dueño cargue. */
  usaDisenoPropio: boolean;
  /* Si la tarjeta tiene un diseño propio GUARDADO aunque hoy no lo esté usando (pasa justo después
     de tocar "usar el mismo diseño de mi negocio", que no borra nada). */
  tieneDisenoGuardado: boolean;
  urls: {
    logo: string | null;
    hero: string | null;
    selloIcono: string | null;
  };
  /* Los formularios de subida (Server Actions aparte) se inyectan en la columna del editor. */
  subidas: ReactNode;
};

/* La BD guarda "rgb(r, g, b)"; el picker nativo habla hex. Convertimos en el cliente. */
function hexDesdeRgb(rgb: string): string {
  const m = rgb.match(/rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i);
  if (!m) return /^#[0-9a-f]{6}$/i.test(rgb.trim()) ? rgb.trim() : '#131315';
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function rgbDesdeTexto(valor: string): string | null {
  const v = valor.trim();
  if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i.test(v)) return v;
  const hex = v.match(/^#?([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
  return null;
}

const CAMPOS_COLOR = [
  ['color_fondo', 'Color de fondo'],
  ['color_texto', 'Color de texto'],
  ['color_label', 'Color de etiqueta'],
] as const;

export default function FormularioBranding({
  nombreComercio,
  esSellos,
  programaId,
  nombreTarjeta,
  inicial,
  heredado,
  usaDisenoPropio,
  tieneDisenoGuardado,
  urls,
  subidas,
}: Props) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    programaId ? accionGuardarBrandingDePrograma.bind(null, programaId) : accionGuardarBranding,
    undefined,
  );

  // Estado controlado: el texto acepta rgb() o hex (los e2e escriben rgb); el picker habla hex.
  const [valores, setValores] = useState({
    color_fondo: inicial.color_fondo,
    color_texto: inicial.color_texto,
    color_label: inicial.color_label,
    sello_meta: inicial.sello_meta,
    difuminado_franja: inicial.difuminado_franja,
  });

  const cambiarTexto =
    (campo: 'color_fondo' | 'color_texto' | 'color_label' | 'sello_meta') =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  const cambiarDifuminado = (e: ChangeEvent<HTMLSelectElement>) =>
    setValores((v) => ({ ...v, difuminado_franja: e.target.value }));

  // BUG conocido de React 19 + Server Actions: al confirmar el submit, el <form> nativo se
  // resetea (igual que un <form> HTML normal al enviarse) y el <select> queda mostrando el
  // valor con el que se sirvió la página — el dato SÍ se guardó bien (verificado contra la BD:
  // esto es solo un problema de DOM, no de persistencia). Los <input> de color no lo sufren
  // porque React los reescribe en cada commit; el <select> solo se reescribe cuando su prop
  // `value` CAMBIA entre renders, y acá no cambia (sigue siendo el mismo valor elegido). La
  // solución: forzar un remount del <select> justo tras cada guardado exitoso, vía `key`.
  const [claveSelect, setClaveSelect] = useState(0);
  const pendienteAnteriorRef = useRef(false);
  useEffect(() => {
    if (pendienteAnteriorRef.current && !pendiente && estado && 'ok' in estado) {
      setClaveSelect((n) => n + 1);
    }
    pendienteAnteriorRef.current = pendiente;
  }, [pendiente, estado]);

  const cambiarPicker =
    (campo: 'color_fondo' | 'color_texto' | 'color_label') =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const rgb = rgbDesdeTexto(e.target.value);
      if (rgb) setValores((v) => ({ ...v, [campo]: rgb }));
    };

  // De dónde sale el color cuando el campo está vacío o a medio escribir. En modo negocio es lo que
  // ya estaba guardado; diseñando UNA tarjeta es lo que hereda del negocio — sin este respaldo, la
  // vista previa de una tarjeta que hereda todo saldría negra y no se parecería en nada a la que el
  // cliente tiene en el teléfono.
  const respaldo: Colores = heredado ?? {
    color_fondo: inicial.color_fondo,
    color_texto: inicial.color_texto,
    color_label: inicial.color_label,
    difuminado_franja: inicial.difuminado_franja,
  };

  const fondo = rgbDesdeTexto(valores.color_fondo) ?? respaldo.color_fondo;
  const texto = rgbDesdeTexto(valores.color_texto) ?? respaldo.color_texto;
  const label = rgbDesdeTexto(valores.color_label) ?? respaldo.color_label;

  const meta = Number(valores.sello_meta) > 0 ? Math.min(20, Number(valores.sello_meta)) : 10;
  const llenos = Math.min(7, meta);
  // Misma función que usa el pass real (lib/apple/stripPass.tsx): el preview y el pass NUNCA
  // pueden mostrar un difuminado distinto para el mismo nivel elegido.
  const stops = stopsDifuminado(valores.difuminado_franja || respaldo.difuminado_franja);

  return (
    <div className="branding-grid">
      {/* -------- VISTA PREVIA EN VIVO (sticky en desktop) --------
          Réplica de la ANATOMÍA REAL del pass de Apple (que es fija: logo arriba a la izquierda,
          franja, campos debajo, QR al pie) — antes el preview inventaba un layout propio y no se
          parecía a lo que llegaba al Wallet (observación del usuario). */}
      <div className="branding-preview reveal d1">
        <p className="titulo-seccion" style={{ marginBottom: 12 }}>
          {programaId ? `Vista previa: ${nombreTarjeta}` : 'Vista previa en vivo'}
        </p>
        {/* En móvil la vista previa va ARRIBA del editor, así que este es el primer lugar donde el
            ojo cae: sin esta línea, quien acaba de tocar "usar el diseño de mi negocio" ve acá el
            diseño propio que sigue cargado y cree que el botón no hizo nada. */}
        {programaId && !usaDisenoPropio && tieneDisenoGuardado && (
          <p className="admin-fila-slug" style={{ marginTop: -6, marginBottom: 12 }}>
            Así quedaría si publicás. Ahora mismo esta tarjeta usa el diseño de tu negocio.
          </p>
        )}
        {/* La tarjeta conserva SU PROPIO fondo (el color que eligió el comercio) en los tres temas
            del panel — es una réplica de lo que va a llegar a la billetera, no una pantalla más del
            panel. Lo ÚNICO que sigue al tema es el borde: es la línea que separa la tarjeta del
            panel, y con el blanco-al-8% de antes un fondo claro se derretía contra el tema claro y
            el dueño no veía dónde terminaba su tarjeta. Todo lo de adentro (velo, difuminado,
            sellos vacíos) sigue midiéndose contra el color del comercio, no contra el panel. */}
        <div
          style={{
            background: fondo,
            color: texto,
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: 'var(--shadow-3)',
            border: '1px solid var(--linea-fuerte)',
          }}
        >
          {/* Cabecera: logo (o el nombre como logoText, igual que el pass real sin logo). */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', minHeight: 52 }}>
            {urls.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
              <img src={urls.logo} alt={`Logo de ${nombreComercio}`} style={{ height: 34, maxWidth: 140, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '1.05rem' }}>{nombreComercio}</span>
            )}
          </div>

          {/* Franja (aspecto real 375:123): foto + velo + difuminado a los bordes + grilla. */}
          <div style={{ position: 'relative', width: '100%', aspectRatio: '375 / 123', overflow: 'hidden' }}>
            {urls.hero && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa simple */}
                <img src={urls.hero} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
                {stops && (
                  <>
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${fondo} 0%, rgba(0,0,0,0) ${stops.v[0]}%, rgba(0,0,0,0) ${stops.v[1]}%, ${fondo} 100%)` }} />
                    <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${fondo} 0%, rgba(0,0,0,0) ${stops.h[0]}%, rgba(0,0,0,0) ${stops.h[1]}%, ${fondo} 100%)` }} />
                  </>
                )}
              </>
            )}
            {esSellos ? (
              <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                {[0, 1].slice(0, meta > 6 ? 2 : 1).map((f) => {
                  const porFila = Math.ceil(meta / (meta > 6 ? 2 : 1));
                  return (
                    <div key={f} style={{ display: 'flex', gap: 6 }}>
                      {Array.from({ length: meta }, (_, i) => i)
                        .slice(f * porFila, (f + 1) * porFila)
                        .map((i) => (
                          <div
                            key={`${meta}-${i}`}
                            className="sello"
                            style={{
                              width: meta > 6 ? 34 : 42,
                              height: meta > 6 ? 34 : 42,
                              animationDelay: `${i * 0.04}s`,
                              // Mismas reglas que el pass real (lib/apple/stripPass.tsx): CON ícono
                              // propio el sello ES el ícono, sin fondo ni borde; SIN ícono, el aro y
                              // el punto. Y sin boxShadow: ese resplandor no existe en el pass, y
                              // esta vista previa se vende como "réplica del pass real".
                              ...(urls.selloIcono
                                ? { background: 'none', border: 'none' }
                                : i < llenos
                                  ? { background: label, border: 'none' }
                                  : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }),
                            }}
                          >
                            {urls.selloIcono ? (
                              // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
                              <img
                                src={urls.selloIcono}
                                alt=""
                                aria-hidden="true"
                                style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: i < llenos ? 1 : 0.32 }}
                              />
                            ) : i < llenos ? (
                              <span style={{ width: '30%', height: '30%', borderRadius: 999, background: fondo }} />
                            ) : (
                              <span className="punto" />
                            )}
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              !urls.hero && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', right: -40, top: -30, width: 180, height: 180, borderRadius: 999, background: label, opacity: 0.14 }} />
                  <div style={{ position: 'absolute', right: 30, bottom: -60, width: 110, height: 110, borderRadius: 999, background: label, opacity: 0.08 }} />
                </div>
              )
            )}
          </div>

          {/* Campo bajo la franja: igual que el pass (label + valor, a la izquierda). */}
          <div style={{ padding: '12px 16px 4px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: label }}>
              {esSellos ? 'Sellos' : 'Puntos'}
            </div>
            <div style={{ fontSize: '1.7rem', lineHeight: 1.2 }}>
              {esSellos ? `${llenos} de ${meta}` : '0'}
            </div>
          </div>

          {/* Zona del QR (siempre presente en el pass real). */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0 20px' }}>
            <div style={{ background: '#fff', borderRadius: 10, padding: 10, display: 'grid', placeItems: 'center' }}>
              <span className="icono icono-lleno" style={{ fontSize: 64, color: '#111' }} aria-hidden="true">qr_code_2</span>
            </div>
          </div>
        </div>
        <p className="nota" style={{ textAlign: 'center' }}>
          Réplica del pass real: Apple define la estructura; vos definís colores, imágenes y sellos.
        </p>
      </div>

      {/* -------- EDITOR -------- */}
      <div className="branding-editor">
        {/* Estado de la tarjeta y la salida. Solo diseñando UNA tarjeta: el negocio no hereda de
            nadie y no tiene a dónde volver. */}
        {programaId && usaDisenoPropio && (
          <BotonUsarDisenoDelNegocio programaId={programaId} nombreTarjeta={nombreTarjeta} />
        )}
        {programaId && !usaDisenoPropio && tieneDisenoGuardado && (
          <p className="admin-vacio" role="status" style={{ marginBottom: 16, padding: '14px 16px', textAlign: 'left' }}>
            Ahora mismo esta tarjeta usa el diseño de tu negocio. Abajo está el diseño propio que le
            habías guardado: si lo publicás, vuelve a usarlo.
          </p>
        )}

        <section className="panel reveal d2" style={{ marginTop: 0 }}>
          <p className="titulo-seccion" style={{ marginBottom: 14 }}>Recursos visuales</p>
          {subidas}
        </section>

        <form className="panel reveal d3" action={ejecutar}>
          <p className="titulo-seccion" style={{ marginBottom: 14 }}>Paleta de colores</p>

          {CAMPOS_COLOR.map(([campo, etiqueta]) => (
            <div className="field" key={campo}>
              <label htmlFor={campo}>{etiqueta}</label>
              <div className="selector-color">
                <input
                  type="color"
                  aria-label={`${etiqueta} (selector)`}
                  value={hexDesdeRgb(valores[campo] || respaldo[campo])}
                  onChange={cambiarPicker(campo)}
                />
                <div style={{ flex: 1 }}>
                  <input
                    id={campo}
                    name={campo}
                    value={valores[campo]}
                    onChange={cambiarTexto(campo)}
                    // Diseñando una tarjeta, el placeholder es el color que HEREDA del negocio: así
                    // el dueño ve qué está usando hoy y entiende que dejarlo vacío no es un error.
                    placeholder={heredado ? respaldo[campo] : 'rgb(19, 19, 21)'}
                    // Obligatorio solo para el negocio: en una tarjeta, vacío = heredá.
                    required={!programaId}
                    style={{ width: '100%' }}
                  />
                  <p className="hex" style={{ marginTop: 4 }}>{hexDesdeRgb(valores[campo] || respaldo[campo])}</p>
                </div>
              </div>
              {/* El aviso va solo acá y solo diseñando una tarjeta: de los tres colores, únicamente
                  el de fondo viaja a la LoyaltyClass de Google. Los otros dos son reversibles. */}
              {programaId && campo === 'color_fondo' && (
                <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>{AVISO_GOOGLE}</p>
              )}
            </div>
          ))}

          {esSellos && (
            <div className="field">
              <label htmlFor="sello_meta">Meta de sellos</label>
              <input
                id="sello_meta"
                name="sello_meta"
                type="number"
                min="1"
                max="20"
                step="1"
                value={valores.sello_meta}
                onChange={cambiarTexto('sello_meta')}
                placeholder="10"
                className="dato-mono"
              />
              {/* La meta NO se hereda: no es diseño, es la mecánica de la tarjeta, y el pase la lee
                  siempre de la tarjeta misma. Un cupón sin meta la tiene vacía LEGÍTIMAMENTE. */}
              {programaId && (
                <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                  Cuántos sellos necesita el cliente para el premio de esta tarjeta.
                </p>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="difuminado_franja">Difuminado de la foto de fondo</label>
            <select
              key={claveSelect}
              id="difuminado_franja"
              name="difuminado_franja"
              value={valores.difuminado_franja}
              onChange={cambiarDifuminado}
            >
              {/* La opción vacía existe SOLO diseñando una tarjeta, y es la herencia: sin ella no
                  habría forma de volver a "como en mi negocio" una vez elegido un nivel. */}
              {heredado && (
                <option value="">
                  Como en mi negocio ({ETIQUETAS_DIFUMINADO[heredado.difuminado_franja as NivelDifuminado] ?? heredado.difuminado_franja})
                </option>
              )}
              {NIVELES_DIFUMINADO.map((nivel) => (
                <option key={nivel} value={nivel}>{ETIQUETAS_DIFUMINADO[nivel]}</option>
              ))}
            </select>
            <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
              Solo se nota si subiste una foto de fondo de la franja. Mirá el cambio arriba, en vivo.
            </p>
          </div>

          <button className="btn-acento" type="submit" disabled={pendiente} style={{ marginTop: 6 }}>
            <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">check_circle</span>
            {pendiente ? 'Publicando…' : 'Publicar cambios'}
          </button>
          {estado && 'error' in estado && (
            <p className="alerta" role="alert">{estado.error}</p>
          )}
          {estado && 'ok' in estado && (
            <p className="nota" style={{ textAlign: 'left' }}>
              {programaId
                ? `Listo. Las tarjetas de ${nombreTarjeta} ya se están actualizando.`
                : 'Branding guardado. Los passes nuevos ya salen con estos colores.'}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

// El botón que devuelve una tarjeta al diseño del negocio. Va en su propio <form> porque el de
// arriba ya tiene su Server Action, y un <form> dentro de otro no es HTML válido.
function BotonUsarDisenoDelNegocio({
  programaId,
  nombreTarjeta,
}: {
  programaId: string;
  nombreTarjeta: string;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionUsarDisenoDelNegocio.bind(null, programaId),
    undefined,
  );

  return (
    <form
      action={ejecutar}
      style={{ marginBottom: 16 }}
      onSubmit={(e) => {
        if (
          !window.confirm(
            `“${nombreTarjeta}” va a verse igual que el resto de tu negocio. No se borra nada: podés volver a su diseño propio cuando quieras.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button className="btn-borde" type="submit" disabled={pendiente}>
        <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">restart_alt</span>
        {pendiente ? 'Aplicando…' : 'Usar el mismo diseño de mi negocio'}
      </button>
      <p className="admin-fila-slug" style={{ marginTop: 6 }}>
        Esta tarjeta tiene su propio diseño. Con esto vuelve a verse como el resto.
      </p>
      {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
    </form>
  );
}
