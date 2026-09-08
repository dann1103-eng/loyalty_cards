'use client';

import {
  useState,
  useRef,
  useEffect,
  type ChangeEvent,
  type PointerEvent as PointerEventReact,
  type ReactNode,
} from 'react';
import { useActionState } from 'react';
import {
  accionGuardarBranding,
  accionGuardarBrandingDePrograma,
  accionUsarDisenoDelNegocio,
  type EstadoBranding,
} from './actions';
import { NIVELES_DIFUMINADO, stopsDifuminado, type NivelDifuminado } from '@/lib/apple/difuminadoFranja';
// La BD guarda "rgb(r, g, b)"; el picker nativo habla hex. La traducción vive en lib/comercio/
// colorHex.ts porque el editor de cartel necesita exactamente la misma: dos copias divergen sin que
// nada avise, y el dueño vería un color distinto en cada pantalla.
import { hexDesdeRgb, rgbDesdeTexto } from '@/lib/comercio/colorHex';
// La MISMA función que arma el frente del pass real (lib/apple/generatePass.ts). Antes esta vista
// previa tenía su propio if/else y una membresía veía "PUNTOS 0", que en el pass no existe.
import { frentePase } from '@/lib/tarjetas/frentePase';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import {
  ENCUADRE_POR_DEFECTO,
  MARCO_FRANJA,
  ZOOM_MINIMO,
  ZOOM_MAXIMO,
  colocarFoto,
  porcentajesDeColocacion,
  focoTrasArrastre,
  type Encuadre,
  type Medidas,
} from '@/lib/comercio/encuadreFranja';

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

const NOMBRE_DE_EJEMPLO = 'Nombre del cliente';

type Props = {
  nombreComercio: string;
  /* El tipo de la tarjeta que se diseña: decide qué campos lleva el frente del pass (frentePase) y
     si hay meta de sellos. Antes era un booleano `esSellos` y todo lo que no fuera sellos se dibujaba
     como puntos — una membresía mostraba "PUNTOS 0". */
  tipoTarjeta: string;
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
  /* Encuadre con el que arranca el formulario: el guardado del negocio (nunca null), o el propio de
     la tarjeta (null si nunca lo tocó → se edita desde el default). */
  encuadreInicial: Encuadre | null;
  /* Si la foto que se ve es PROPIA de lo que se diseña (negocio: hay foto; tarjeta: hero_url propio).
     Decide si los cuatro campos del encuadre viajan y si el bloque se edita — el encuadre viaja con
     la foto, no se hereda campo por campo (brandingEfectivo). */
  fotoPropia: boolean;
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
    strip: string | null;
    selloIcono: string | null;
  };
  /* Los formularios de subida (Server Actions aparte) se inyectan en la columna del editor. */
  subidas: ReactNode;
};

const CAMPOS_COLOR = [
  ['color_fondo', 'Color de fondo'],
  ['color_texto', 'Color de texto'],
  ['color_label', 'Color de etiqueta'],
] as const;

export default function FormularioBranding({
  nombreComercio,
  tipoTarjeta,
  programaId,
  nombreTarjeta,
  inicial,
  heredado,
  encuadreInicial,
  fotoPropia,
  usaDisenoPropio,
  tieneDisenoGuardado,
  urls,
  subidas,
}: Props) {
  const esSellos = tipoOPuntos(tipoTarjeta).valor === 'sellos';

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

  // La meta NO se inventa. Hasta el 2026-07-31 esta línea caía a `10` con el campo vacío, y la
  // vista previa dibujaba una grilla completa de "7 de 10". Un comercio real (Barbiere Di Paolo)
  // configuró su ícono de sellos, vio la grilla acá, y sus clientes recibieron una tarjeta con un
  // "0" pelado y SIN grilla — porque el pase lee la meta REAL, que estaba en null. La pantalla le
  // confirmó una configuración que no existía, que es lo contrario de para lo que sirve un preview.
  //
  // Los 7 sellos llenos SÍ son una demostración legítima: el progreso varía por cliente y el dueño
  // necesita ver cómo se llena la grilla. Pero la META es configuración suya, y sin ella acá tiene
  // que verse exactamente lo mismo que va a ver el cliente.
  const metaConfigurada = Number(valores.sello_meta) > 0 ? Math.min(20, Number(valores.sello_meta)) : null;
  const meta = metaConfigurada ?? 0;
  const llenos = Math.min(7, meta);
  // Misma función que usa el pass real (lib/apple/stripPass.tsx): el preview y el pass NUNCA
  // pueden mostrar un difuminado distinto para el mismo nivel elegido.
  const stops = stopsDifuminado(valores.difuminado_franja || respaldo.difuminado_franja);

  // ---- encuadre de la foto de la franja ---------------------------------------------------------
  const [encuadre, setEncuadre] = useState<Encuadre>(encuadreInicial ?? ENCUADRE_POR_DEFECTO);
  // Medidas naturales de la foto: null hasta el onLoad. Sin ellas la foto se dibuja con cover
  // centrado y no se arrastra (colocarFoto exige medidas válidas y devolvería el marco pelado).
  const [medidasFoto, setMedidasFoto] = useState<Medidas | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const ultimoPunteroRef = useRef<{ x: number; y: number } | null>(null);

  const hayFoto = Boolean(urls.hero);
  const hayStrip = Boolean(urls.strip);
  // Cuándo VIAJAN los cuatro campos vs cuándo se VEN los controles: dos reglas distintas a propósito
  // (spec, sección Editor). En el negocio viajan SIEMPRE (las columnas son NOT NULL, y un negocio sin
  // foto tiene que poder publicar colores); en una tarjeta, solo con foto propia (sin ella no viajan
  // → null → hereda el del negocio). Si viajaran solo cuando se ven, publicar los colores con una
  // franja personalizada puesta le borraría al dueño el encuadre que ya había ajustado.
  const mandaEncuadre = programaId ? fotoPropia : true;
  const editaEncuadre = hayFoto && !hayStrip && fotoPropia;
  const puedeArrastrar = editaEncuadre && medidasFoto !== null;

  // La colocación se pide en PORCENTAJES del marco: así el mismo cálculo sirve para el contenedor de
  // cualquier ancho (la vista previa es fluida) sin tener que medirlo en cada render.
  const colocacion = medidasFoto
    ? porcentajesDeColocacion(colocarFoto(medidasFoto, MARCO_FRANJA, encuadre), MARCO_FRANJA)
    : null;

  function alAgarrarFoto(e: PointerEventReact<HTMLDivElement>) {
    if (!puedeArrastrar) return;
    // Capturar el puntero es lo que hace que el arrastre siga funcionando cuando el dedo se sale del
    // marco (y lo que evita que el navegador lo interprete como scroll, junto a touchAction: none).
    e.currentTarget.setPointerCapture(e.pointerId);
    ultimoPunteroRef.current = { x: e.clientX, y: e.clientY };
    setArrastrando(true);
  }

  function alMoverFoto(e: PointerEventReact<HTMLDivElement>) {
    const anterior = ultimoPunteroRef.current;
    if (!anterior || !medidasFoto) return;
    const caja = e.currentTarget.getBoundingClientRect();
    // Delta INCREMENTAL (desde el último pointermove, no acumulado desde el pointerdown): al pasarse
    // del borde el foco se acota en 0 o 100 y, al volver, la foto responde de inmediato en vez de
    // quedarse pegada hasta que el puntero desande todo el exceso.
    const delta = { x: e.clientX - anterior.x, y: e.clientY - anterior.y };
    ultimoPunteroRef.current = { x: e.clientX, y: e.clientY };
    // El foco se calcula DENTRO del updater, sobre `v` y no sobre el `encuadre` del closure: con
    // varios pointermove entre dos commits de React, el delta incremental se aplicaría a una base
    // vieja y se perderían movimientos (la foto "se traba" al arrastrar rápido).
    setEncuadre((v) => ({
      ...v,
      ...focoTrasArrastre(v, delta, medidasFoto, { ancho: caja.width, alto: caja.height }),
    }));
  }

  function alSoltarFoto(e: PointerEventReact<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    ultimoPunteroRef.current = null;
    setArrastrando(false);
    // Los focos se guardan como ENTEROS (validarEncuadre los rechaza si no lo son); durante el
    // arrastre son floats para no perder los desplazamientos chicos.
    setEncuadre((v) => ({ ...v, focoX: Math.round(v.focoX), focoY: Math.round(v.focoY) }));
  }

  // ---- frente del pass --------------------------------------------------------------------------
  // La misma función que arma el pass real. Contador 0 (tarjeta recién emitida) salvo en sellos, que
  // conserva la demostración de 7 llenos. `hayGrilla` asume composición exitosa: el navegador no
  // puede saber si next/og falló, y nadie intenta replicar acá ese fallback.
  const frente = frentePase({
    tipoTarjeta,
    puntos: esSellos ? llenos : 0,
    selloMeta: esSellos ? metaConfigurada : null,
    hayGrilla: esSellos && metaConfigurada !== null && !hayStrip,
  });

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

          {/* Franja (aspecto real 375:123): foto encuadrada + velo + difuminado a los bordes + grilla.
              Es también la superficie de arrastre del encuadre cuando hay foto propia. */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '375 / 123',
              overflow: 'hidden',
              // Sin touchAction: 'none' el navegador se queda el gesto para hacer scroll y el
              // pointermove nunca llega.
              touchAction: puedeArrastrar ? 'none' : undefined,
              cursor: puedeArrastrar ? (arrastrando ? 'grabbing' : 'grab') : undefined,
            }}
            onPointerDown={alAgarrarFoto}
            onPointerMove={alMoverFoto}
            onPointerUp={alSoltarFoto}
            onPointerCancel={alSoltarFoto}
            aria-label={puedeArrastrar ? 'Arrastrá la foto para encuadrarla' : undefined}
          >
            {urls.strip ? (
              // La franja personalizada reemplaza TODO lo que va en esta zona: el pass la usa tal cual,
              // sin velo, sin difuminado, sin encuadre y sin grilla de sellos.
              // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
              <img
                src={urls.strip}
                alt=""
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <>
                {urls.hero && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element -- vista previa simple */}
                    <img
                      src={urls.hero}
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      onLoad={(e) => setMedidasFoto({ ancho: e.currentTarget.naturalWidth, alto: e.currentTarget.naturalHeight })}
                      // Con las medidas ya conocidas manda colocarFoto; antes del onLoad, cover centrado
                      // (que es exactamente lo que da el encuadre por defecto, así no hay salto).
                      // maxWidth: 'none' es obligatorio: con zoom o en modo "llenar" la foto puede medir
                      // 200%+ del marco, y cualquier regla de reset `img { max-width: 100% }` la aplastaría.
                      style={colocacion
                        ? { position: 'absolute', left: `${colocacion.left}%`, top: `${colocacion.top}%`, width: `${colocacion.ancho}%`, height: `${colocacion.alto}%`, maxWidth: 'none' }
                        : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} />
                    {stops && (
                      <>
                        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${fondo} 0%, rgba(0,0,0,0) ${stops.v[0]}%, rgba(0,0,0,0) ${stops.v[1]}%, ${fondo} 100%)` }} />
                        <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(90deg, ${fondo} 0%, rgba(0,0,0,0) ${stops.h[0]}%, rgba(0,0,0,0) ${stops.h[1]}%, ${fondo} 100%)` }} />
                      </>
                    )}
                  </>
                )}
                {esSellos && metaConfigurada === null ? (
                  // Sin meta configurada NO hay grilla, ni acá ni en el pase real: generatePass exige
                  // `selloMeta > 0` para dibujarla. Antes esta rama no existía y se dibujaba una grilla
                  // inventada de 10; ahora se muestra lo mismo que verá el cliente, y se dice por qué.
                  // El paddingBottom deja libre la esquina donde ahora se dibuja el campo primario
                  // ("SELLOS 0"): sin él, este aviso centrado y el contador se pisan.
                  <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 24px 34px' }}>
                    <p style={{ fontSize: '0.78rem', textAlign: 'center', opacity: 0.75, margin: 0 }}>
                      Poné la meta de sellos abajo para que aparezca la grilla. Sin ella, tus clientes
                      ven solo un contador.
                    </p>
                  </div>
                ) : esSellos ? (
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
              </>
            )}

            {/* El campo primario va SOBRE la franja, abajo a la izquierda: ahí dibuja Apple los
                primaryFields de un storeCard. Los tipos sin contador (cupón, membresía, descuento) no
                lo tienen, y con grilla de sellos tampoco — el texto taparía los círculos. */}
            {frente.primario && (
              <div style={{ position: 'absolute', left: 16, bottom: 10, pointerEvents: 'none' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: label }}>
                  {frente.primario.etiqueta}
                </div>
                <div style={{ fontSize: '1.7rem', lineHeight: 1.2, color: texto }}>{frente.primario.valor}</div>
              </div>
            )}
          </div>

          {/* Fila secundaria, debajo de la franja: el contador de sellos con grilla a la izquierda (si
              lo hay) y el titular a la derecha, como el pass real. El minHeight la reserva aunque no
              haya secundario, para que la tarjeta no cambie de alto al elegir otro tipo. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, padding: '12px 16px 4px', minHeight: 44 }}>
            {frente.secundario ? (
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: label }}>
                  {frente.secundario.etiqueta}
                </div>
                <div style={{ fontSize: '1.1rem', lineHeight: 1.2 }}>{frente.secundario.valor}</div>
              </div>
            ) : (
              <span />
            )}
            <div style={{ textAlign: 'right', fontSize: '0.95rem', opacity: 0.9 }}>{NOMBRE_DE_EJEMPLO}</div>
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

          {/* Todo lo que decide CÓMO SE VE la foto de fondo, junto: encuadre, posición, zoom y
              difuminado. El difuminado vivía suelto y quedaba a dos secciones del control que lo
              afecta.
              La `key` con claveSelect remonta el bloque entero tras cada guardado exitoso, por el
              mismo bug de React 19 explicado más arriba: el reset nativo del <form> devuelve al DOM
              los valores servidos con la página, y ni el <select> ni los radios ni los deslizadores
              se reescriben si su prop no cambió. */}
          <fieldset key={`encuadre-${claveSelect}`} className="encuadre-franja">
            <legend className="titulo-seccion">Foto de fondo de la franja</legend>

            {/* Los cuatro campos viajan SIEMPRE que corresponda, ocultos si no se editan: si viajaran
                solo cuando se ven, publicar los colores con una franja personalizada puesta mandaría
                cuatro vacíos, encuadreDesdeFormulario daría null y el guardado borraría el encuadre
                que el dueño ya había ajustado. */}
            {mandaEncuadre && !editaEncuadre && (
              <>
                <input type="hidden" name="encuadre_franja" value={encuadre.modo} />
                <input type="hidden" name="foco_franja_x" value={Math.round(encuadre.focoX)} />
                <input type="hidden" name="foco_franja_y" value={Math.round(encuadre.focoY)} />
                <input type="hidden" name="zoom_franja" value={encuadre.zoom} />
              </>
            )}

            {editaEncuadre && (
              <>
                <div className="field">
                  <span className="field-etiqueta">Encuadre</span>
                  <div className="encuadre-modos" role="radiogroup" aria-label="Encuadre">
                    <label>
                      <input
                        type="radio"
                        name="encuadre_franja"
                        value="llenar"
                        checked={encuadre.modo === 'llenar'}
                        onChange={() => setEncuadre((v) => ({ ...v, modo: 'llenar' }))}
                      />{' '}
                      Llenar (recorta)
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="encuadre_franja"
                        value="completa"
                        checked={encuadre.modo === 'completa'}
                        onChange={() => setEncuadre((v) => ({ ...v, modo: 'completa' }))}
                      />{' '}
                      Completa (sin recortar)
                    </label>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="foco_franja_x">
                    Posición horizontal <span className="dato-mono">{Math.round(encuadre.focoX)}</span>
                  </label>
                  <input
                    id="foco_franja_x"
                    name="foco_franja_x"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(encuadre.focoX)}
                    onChange={(e) => setEncuadre((v) => ({ ...v, focoX: Number(e.target.value) }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="foco_franja_y">
                    Posición vertical <span className="dato-mono">{Math.round(encuadre.focoY)}</span>
                  </label>
                  <input
                    id="foco_franja_y"
                    name="foco_franja_y"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(encuadre.focoY)}
                    onChange={(e) => setEncuadre((v) => ({ ...v, focoY: Number(e.target.value) }))}
                  />
                </div>
                <div className="field">
                  <label htmlFor="zoom_franja">
                    Zoom <span className="dato-mono">{encuadre.zoom}%</span>
                  </label>
                  {/* Los deslizadores siguen existiendo aunque haya arrastre: son la precisión y el
                      único camino por teclado. */}
                  <input
                    id="zoom_franja"
                    name="zoom_franja"
                    type="range"
                    min={ZOOM_MINIMO}
                    max={ZOOM_MAXIMO}
                    step={5}
                    value={encuadre.zoom}
                    onChange={(e) => setEncuadre((v) => ({ ...v, zoom: Number(e.target.value) }))}
                  />
                </div>
                <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                  También podés arrastrar la foto en la vista previa.
                </p>
              </>
            )}

            {programaId && hayFoto && !fotoPropia && !hayStrip && (
              <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                Esta tarjeta usa la foto de tu negocio, y el encuadre acompaña a la foto: se ajusta
                desde “Todas mis tarjetas”. Subí una foto propia arriba para encuadrarla acá.
              </p>
            )}
            {hayStrip && (
              <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                La franja personalizada reemplaza a la foto de fondo: el encuadre y el difuminado no
                aplican mientras esté puesta.
              </p>
            )}
            {!hayFoto && !hayStrip && (
              <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
                Subí una foto de fondo de la franja arriba para encuadrarla.
              </p>
            )}

            <div className="field" style={{ marginTop: 16, marginBottom: 0 }}>
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
          </fieldset>

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
