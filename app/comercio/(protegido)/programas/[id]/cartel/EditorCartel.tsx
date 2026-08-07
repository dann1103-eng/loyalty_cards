'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { construirCartelSvg } from '@/lib/comercio/cartel/plantillas';
import { dibujarTextoConFuenteDelSistema } from '@/lib/comercio/cartel/texto';
import type { DatosCartel, FormatoCartel, PlantillaCartel } from '@/lib/comercio/cartel/tipos';
import { PLANTILLAS_CARTEL, FORMATOS_CARTEL } from '@/lib/comercio/cartel/tipos';
import { hexDesdeRgb, rgbDesdeTexto } from '@/lib/comercio/colorHex';
import { ctaSugerido } from '@/lib/comercio/cartel/ctaSugerido';
import {
  MAX_ELEMENTOS,
  LIMITES_TEXTO,
  LIMITES_FRANJA,
  type ElementoCartel,
} from '@/lib/comercio/cartel/elementos';
import {
  desfaseDeAgarre,
  posicionArrastrada,
  moverConTeclado,
  type Punto,
} from '@/lib/comercio/cartel/arrastre';
import {
  accionGuardarCartel,
  accionSubirLogoCartel,
  accionQuitarLogoCartel,
  type EstadoCartel,
} from './actions';

const ETIQUETAS_PLANTILLA: Record<PlantillaCartel, string> = {
  centrado: 'Centrado clásico',
  split: 'Franja de color + QR',
  foto: 'Foto de fondo',
};

// El dueño es un comerciante, no un diseñador: los formatos se nombran por dónde se ponen y qué
// miden en centímetros, no por su nombre técnico.
const ETIQUETAS_FORMATO: Record<FormatoCartel, string> = {
  sticker: 'Sticker de mesa (10 × 10 cm)',
  mostrador: 'Cartel de mostrador (A5, media hoja)',
};

// Un control deslizante con su etiqueta y su valor a la vista. Existe porque cada elemento libre
// necesita entre tres y cinco de estos y repetir el markup los desincroniza.
//
// Deslizante y no un campo numérico a propósito: el dueño es un comerciante mirando una vista previa
// en el teléfono, no un diseñador escribiendo coordenadas. Arrastrar y ver el texto moverse es la
// interacción correcta acá; escribir "72.5" no significa nada para nadie.
function Deslizador({
  id,
  etiqueta,
  valor,
  min,
  max,
  paso,
  alCambiar,
}: {
  id: string;
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso: number;
  alCambiar: (valor: number) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {etiqueta} <span className="admin-fila-slug">({Math.round(valor)}%)</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={paso}
        value={valor}
        onChange={(e) => alCambiar(Number(e.target.value))}
      />
    </div>
  );
}

export default function EditorCartel({
  programaId,
  datosResueltos,
  marcaEfectiva,
  personalizadoInicial,
  tieneLogoPropio,
  tipoTarjeta,
}: {
  programaId: string;
  datosResueltos: DatosCartel;
  /* Los colores a los que vuelve el cartel cuando se apaga la personalización: la marca EFECTIVA
     del programa (la suya si tiene propia, la del negocio si hereda), ya resuelta en el servidor. */
  marcaEfectiva: { colorFondo: string; colorTexto: string; colorLabel: string };
  personalizadoInicial: boolean;
  tieneLogoPropio: boolean;
  /* Solo para ofrecer la frase sugerida: el cartel que se dibuja ya la trae resuelta en textoCta. */
  tipoTarjeta: string;
}) {
  const [plantilla, setPlantilla] = useState<PlantillaCartel>(datosResueltos.plantilla);
  const [personalizar, setPersonalizar] = useState(personalizadoInicial);
  const [colorFondo, setColorFondo] = useState(datosResueltos.colorFondo);
  const [colorTexto, setColorTexto] = useState(datosResueltos.colorTexto);
  const [colorLabel, setColorLabel] = useState(datosResueltos.colorLabel);
  const [textoCta, setTextoCta] = useState(datosResueltos.textoCta);
  const [textoTeaser, setTextoTeaser] = useState(datosResueltos.textoTeaser ?? '');
  const [elementos, setElementos] = useState<ElementoCartel[]>(datosResueltos.elementos);
  const [formato, setFormato] = useState<FormatoCartel>('sticker');
  const [previewSvg, setPreviewSvg] = useState<string>('');

  const inputLogoRef = useRef<HTMLInputElement>(null);
  // El contenedor de la vista previa: se mide en cada movimiento del puntero (y no una vez) porque
  // su ancho cambia al rotar el teléfono, al abrir el teclado o al cambiar de formato, y una medida
  // vieja desalinea el arrastre sin que nada falle.
  const lienzoRef = useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = useState<{ indice: number; desfase: Punto } | null>(null);

  // Al apagar la personalización, los inputs vuelven a la marca actual — NUNCA a un valor guardado
  // escondido (spec §6.3). Al prenderla, arrancan de lo que ya se ve (que en ese momento coincide
  // con la marca, porque veníamos de apagado).
  function alternarPersonalizar(activar: boolean) {
    setPersonalizar(activar);
    if (!activar) {
      setColorFondo(marcaEfectiva.colorFondo);
      setColorTexto(marcaEfectiva.colorTexto);
      setColorLabel(marcaEfectiva.colorLabel);
    }
  }

  const datosVivos: DatosCartel = useMemo(
    () => ({
      ...datosResueltos,
      plantilla,
      colorFondo,
      colorTexto,
      colorLabel,
      textoCta,
      textoTeaser: textoTeaser.trim() || null,
      elementos,
    }),
    [datosResueltos, plantilla, colorFondo, colorTexto, colorLabel, textoCta, textoTeaser, elementos],
  );

  // Vista previa en vivo: la MISMA función que arma el PNG/PDF exportado (construirCartelSvg), sin
  // ida y vuelta al servidor. Es async porque `qrcode` expone una API por promesa (no hace ningún
  // fetch de red). DEBE ser useEffect y no useMemo: solo useEffect ejecuta la función de limpieza
  // que retorna — con useMemo, `vigente` nunca se pondría en false y una respuesta lenta y obsoleta
  // podría pisar una vista previa más nueva ante cambios rápidos de plantilla/color/formato.
  //
  // El texto va como <text> y NO convertido a contornos como en la descarga: acá corre el navegador,
  // que sí tiene fuentes, y traerse `opentype.js` más el megabyte de Inter al bundle del cliente
  // para dibujar una miniatura de 260 px sería cobrárselo al teléfono del dueño sin necesidad.
  useEffect(() => {
    let vigente = true;
    construirCartelSvg(datosVivos, formato, dibujarTextoConFuenteDelSistema).then((svg) => {
      if (vigente) setPreviewSvg(svg);
    });
    return () => {
      vigente = false;
    };
  }, [datosVivos, formato]);

  const guardar = accionGuardarCartel.bind(null, programaId);
  const [estadoGuardar, ejecutarGuardar, guardando] = useActionState<EstadoCartel, FormData>(guardar, undefined);

  const subirLogo = accionSubirLogoCartel.bind(null, programaId);
  const [estadoLogo, ejecutarSubirLogo, subiendoLogo] = useActionState<EstadoCartel, FormData>(subirLogo, undefined);

  const quitarLogo = accionQuitarLogoCartel.bind(null, programaId);
  const [estadoQuitarLogo, ejecutarQuitarLogo, quitandoLogo] = useActionState<EstadoCartel, FormData>(
    quitarLogo,
    undefined,
  );

  const error =
    (estadoGuardar && 'error' in estadoGuardar && estadoGuardar.error) ||
    (estadoLogo && 'error' in estadoLogo && estadoLogo.error) ||
    (estadoQuitarLogo && 'error' in estadoQuitarLogo && estadoQuitarLogo.error) ||
    null;

  // Los extras se editan como una lista en memoria y viajan al servidor como UN campo JSON. El
  // servidor NO confía en lo que llega: `accionGuardarCartel` lo vuelve a pasar por sanearElementos.
  function actualizarElemento(indice: number, cambios: Partial<ElementoCartel>) {
    setElementos((previos) =>
      previos.map((e, i) => (i === indice ? ({ ...e, ...cambios } as ElementoCartel) : e)),
    );
  }

  function quitarElemento(indice: number) {
    setElementos((previos) => previos.filter((_, i) => i !== indice));
  }

  // --- arrastrar los agregados sobre la vista previa -------------------------------------------
  // La aritmética vive en lib/comercio/cartel/arrastre.ts (pura y con pruebas); acá queda solo el
  // pegamento con el DOM: medir la caja, capturar el puntero y escribir el estado.
  //
  // Eventos de PUNTERO y no de ratón: es el único juego que cubre dedo, lápiz y ratón con el mismo
  // código, y `setPointerCapture` es lo que hace que el arrastre siga funcionando cuando el dedo se
  // sale del recuadro — sin eso, mover rápido suelta el elemento a mitad de camino.
  function alAgarrar(evento: React.PointerEvent<HTMLButtonElement>, indice: number) {
    const caja = lienzoRef.current?.getBoundingClientRect();
    if (!caja) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    const elemento = elementos[indice];
    setArrastre({
      indice,
      desfase: desfaseDeAgarre({ x: evento.clientX, y: evento.clientY }, caja, elemento),
    });
  }

  function alMoverPuntero(evento: React.PointerEvent<HTMLButtonElement>) {
    if (!arrastre) return;
    const caja = lienzoRef.current?.getBoundingClientRect();
    if (!caja) return;
    const elemento = elementos[arrastre.indice];
    if (!elemento) return;
    actualizarElemento(
      arrastre.indice,
      posicionArrastrada({ x: evento.clientX, y: evento.clientY }, caja, arrastre.desfase, elemento),
    );
  }

  function alSoltar(evento: React.PointerEvent<HTMLButtonElement>) {
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
    setArrastre(null);
  }

  function alTeclearSobreManija(evento: React.KeyboardEvent<HTMLButtonElement>, indice: number) {
    const elemento = elementos[indice];
    if (!elemento) return;
    const movido = moverConTeclado(elemento, evento.key, evento.shiftKey);
    // Solo se cancela el evento cuando la tecla ERA una flecha: tragarse todas dejaría a Tab sin
    // poder salir de la manija, y quien navega con teclado quedaría atrapado en la vista previa.
    if (!movido) return;
    evento.preventDefault();
    actualizarElemento(indice, movido);
  }

  // Los nuevos nacen en el centro y con la escala de un texto de cartel: puestos en 0,0 quedarían
  // pegados al borde superior izquierdo, donde en dos de las tres plantillas hay logo encima y el
  // dueño creería que no se agregó nada.
  function agregarTexto() {
    if (elementos.length >= MAX_ELEMENTOS) return;
    setElementos((previos) => [
      ...previos,
      { tipo: 'texto', texto: 'Tu texto', x: 50, y: 50, tamano: 4, color: colorTexto, peso: 700 },
    ]);
  }

  function agregarFranja() {
    if (elementos.length >= MAX_ELEMENTOS) return;
    setElementos((previos) => [
      ...previos,
      { tipo: 'franja', x: 0, y: 45, ancho: 100, alto: 8, color: colorLabel, radio: 0 },
    ]);
  }

  const frasePropuesta = ctaSugerido(tipoTarjeta);

  // Las manijas se PINTAN en el mismo orden que el dibujo: franjas primero, textos después (o sea,
  // los textos por encima). No es cosmético — sin esto, agregar una franja grande después de un
  // texto sepulta la manija del texto, que es un <button> del tamaño de la franja, y ese texto se
  // vuelve imposible de agarrar. Se detectó midiendo con elementsFromPoint sobre la vista previa
  // real, no razonándolo.
  //
  // El índice que viaja es el de la lista ORIGINAL: es el que usan actualizarElemento y el número
  // que ve el dueño, así que el orden de pintado no puede tocarlo. `.entries()` es justamente lo que
  // lo conserva al reordenar.
  const manijasOrdenadas = useMemo(
    () =>
      [...elementos.entries()].sort(
        ([, a], [, b]) => (a.tipo === 'franja' ? 0 : 1) - (b.tipo === 'franja' ? 0 : 1),
      ),
    [elementos],
  );

  // "Foto de fondo" sin foto produciría un cartel con fondo liso (spec §7): plantillaFoto() cae a un
  // color sólido, pero ofrecerla igual sería prometer algo que no se va a ver.
  const hayFoto = datosResueltos.fotoDataUri != null;

  return (
    <div className="reveal d2">
      <section className="panel" style={{ marginTop: 18 }}>
        <p className="titulo-seccion" style={{ marginBottom: 14 }}>Así se va a imprimir</p>

        <div className="field">
          <label htmlFor="formato">Tamaño</label>
          <select
            id="formato"
            value={formato}
            onChange={(e) => setFormato(e.target.value as FormatoCartel)}
          >
            {FORMATOS_CARTEL.map((f) => (
              <option key={f} value={f}>{ETIQUETAS_FORMATO[f]}</option>
            ))}
          </select>
        </div>

        {previewSvg && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            {/* El ref va en el CONTENEDOR y no en el SVG: `cartel-preview svg` ocupa el 100% del
                ancho con height auto, así que las dos cajas coinciden, y medir el contenedor no
                obliga a buscar el nodo del SVG dentro de un innerHTML. */}
            <div ref={lienzoRef} className="cartel-lienzo" style={{ maxWidth: 260, width: '100%' }}>
              {/* El SVG lo construye construirCartelSvg, que escapa TODO texto libre con escaparXml
                  (ver plantillas.ts): no hay markup del dueño llegando acá sin pasar por ahí.
                  `cartel-preview` es lo que lo achica a la caja (el SVG trae su tamaño en mm). */}
              <div className="cartel-preview" dangerouslySetInnerHTML={{ __html: previewSvg }} />

              {elementos.length > 0 && (
                <div className="cartel-capa-manijas">
                  {manijasOrdenadas.map(([indice, elemento]) => {
                    const arrastrandoEste = arrastre?.indice === indice;
                    // Una franja se agarra por TODA su superficie —es lo que uno espera de un
                    // bloque de color— y un texto por un punto sobre su ancla: un texto no tiene
                    // caja conocida de este lado (el ancho real lo sabe la fuente, no el DOM).
                    const estilo =
                      elemento.tipo === 'franja'
                        ? {
                            left: `${elemento.x}%`,
                            top: `${elemento.y}%`,
                            width: `${elemento.ancho}%`,
                            height: `${elemento.alto}%`,
                          }
                        : { left: `${elemento.x}%`, top: `${elemento.y}%` };

                    return (
                      <button
                        key={indice}
                        type="button"
                        className={
                          elemento.tipo === 'franja'
                            ? 'cartel-manija'
                            : 'cartel-manija cartel-manija-punto'
                        }
                        style={estilo}
                        data-arrastrando={arrastrandoEste ? 'si' : 'no'}
                        aria-label={`Mover ${elemento.tipo === 'texto' ? `el texto "${elemento.texto}"` : 'la franja'} (${indice + 1} de ${elementos.length}). Arrastralo, o movelo con las flechas.`}
                        onPointerDown={(e) => alAgarrar(e, indice)}
                        onPointerMove={alMoverPuntero}
                        onPointerUp={alSoltar}
                        onPointerCancel={alSoltar}
                        onKeyDown={(e) => alTeclearSobreManija(e, indice)}
                      >
                        <span className="cartel-manija-numero" aria-hidden="true">
                          {indice + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        {elementos.length > 0 && (
          <p className="admin-fila-slug" style={{ textAlign: 'center', marginTop: 10 }}>
            Arrastrá los recuadros para acomodarlos. Con el teclado: Tab para elegir uno y las
            flechas para moverlo (con Shift va más rápido).
          </p>
        )}
      </section>

      <form className="panel" action={ejecutarGuardar}>
        <p className="titulo-seccion" style={{ marginBottom: 14 }}>Diseño</p>

        <div className="field">
          <label htmlFor="plantilla">Estilo</label>
          <select
            id="plantilla"
            name="plantilla"
            value={plantilla}
            onChange={(e) => setPlantilla(e.target.value as PlantillaCartel)}
          >
            {PLANTILLAS_CARTEL.map((p) => (
              <option key={p} value={p} disabled={p === 'foto' && !hayFoto}>
                {ETIQUETAS_PLANTILLA[p]}
              </option>
            ))}
          </select>
          {!hayFoto && (
            <p className="admin-fila-slug" style={{ marginTop: 6 }}>
              Para usar &quot;Foto de fondo&quot; subí primero una foto en Marca.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="personalizar" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="personalizar"
              name="personalizar"
              type="checkbox"
              checked={personalizar}
              onChange={(e) => alternarPersonalizar(e.target.checked)}
            />
            Usar colores distintos solo en este cartel
          </label>
          <p className="admin-fila-slug" style={{ marginTop: 6 }}>
            Sin esto, el cartel usa los colores de tu marca. Si los cambiás en Marca, el cartel se
            actualiza solo.
          </p>
        </div>

        {personalizar && (
          <>
            {/* Los `<input type="color">` NO llevan `name`: el navegador solo entiende #rrggbb y la
                base guarda rgb(r, g, b). Lo que viaja en el formulario son los hidden de abajo, ya
                traducidos — si el selector mandara su propio valor, la columna quedaría en un
                formato que el resto del sistema no lee. */}
            <div className="field">
              <label htmlFor="picker_fondo">Color de fondo</label>
              <div className="selector-color">
                <input
                  id="picker_fondo"
                  type="color"
                  value={hexDesdeRgb(colorFondo)}
                  onChange={(e) => setColorFondo(rgbDesdeTexto(e.target.value) ?? colorFondo)}
                />
                <span className="hex">{hexDesdeRgb(colorFondo)}</span>
              </div>
              <input type="hidden" name="color_fondo" value={colorFondo} />
            </div>

            <div className="field">
              <label htmlFor="picker_texto">Color del texto</label>
              <div className="selector-color">
                <input
                  id="picker_texto"
                  type="color"
                  value={hexDesdeRgb(colorTexto)}
                  onChange={(e) => setColorTexto(rgbDesdeTexto(e.target.value) ?? colorTexto)}
                />
                <span className="hex">{hexDesdeRgb(colorTexto)}</span>
              </div>
              <input type="hidden" name="color_texto" value={colorTexto} />
            </div>

            <div className="field">
              <label htmlFor="picker_label">Color de la frase destacada</label>
              <div className="selector-color">
                <input
                  id="picker_label"
                  type="color"
                  value={hexDesdeRgb(colorLabel)}
                  onChange={(e) => setColorLabel(rgbDesdeTexto(e.target.value) ?? colorLabel)}
                />
                <span className="hex">{hexDesdeRgb(colorLabel)}</span>
              </div>
              <input type="hidden" name="color_label" value={colorLabel} />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="texto_cta">Frase principal</label>
          <input
            id="texto_cta"
            name="texto_cta"
            value={textoCta}
            maxLength={60}
            required
            onChange={(e) => setTextoCta(e.target.value)}
          />
          {/* La sugerencia depende de lo que ESTA tarjeta hace (sellos, puntos, cashback…). El
              atajo solo aparece cuando la frase actual no es ya la sugerida: un botón que no
              cambiaría nada al tocarlo enseña a ignorar los botones. */}
          {textoCta.trim() !== frasePropuesta && (
            <button
              type="button"
              className="btn-borde"
              style={{ marginTop: 8 }}
              onClick={() => setTextoCta(frasePropuesta)}
            >
              Usar la sugerida: {frasePropuesta}
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="texto_teaser">Segunda línea (opcional)</label>
          <input
            id="texto_teaser"
            name="texto_teaser"
            value={textoTeaser}
            maxLength={60}
            placeholder="Tu 5to café gratis"
            onChange={(e) => setTextoTeaser(e.target.value)}
          />
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '4px 0 18px' }}>
          <legend className="titulo-seccion" style={{ marginBottom: 6 }}>Agregados</legend>
          <p className="admin-fila-slug" style={{ marginTop: 0, marginBottom: 12 }}>
            Textos y franjas de color que ponés donde quieras. Se ven en la vista previa de arriba
            mientras los movés.
          </p>

          {/* Toda la lista en UN campo JSON: son elementos de largo variable y de forma distinta
              según el tipo, y reconstruirla desde inputs con nombres numerados sería inventar un
              protocolo propio con más superficie de bug. El servidor no confía en esto: lo vuelve a
              pasar por sanearElementos antes de guardarlo. */}
          <input type="hidden" name="elementos" value={JSON.stringify(elementos)} />

          {elementos.map((elemento, indice) => (
            <div key={indice} className="panel" style={{ padding: 14, marginBottom: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 14 }}>
                  {elemento.tipo === 'texto' ? 'Texto' : 'Franja de color'}
                </strong>
                <button type="button" className="btn-borde" onClick={() => quitarElemento(indice)}>
                  Quitar
                </button>
              </div>

              {elemento.tipo === 'texto' && (
                <>
                  <div className="field">
                    <label htmlFor={`el_texto_${indice}`}>Qué dice</label>
                    <input
                      id={`el_texto_${indice}`}
                      value={elemento.texto}
                      maxLength={LIMITES_TEXTO.largo}
                      onChange={(e) => actualizarElemento(indice, { texto: e.target.value })}
                    />
                  </div>
                  <Deslizador
                    id={`el_tam_${indice}`}
                    etiqueta="Tamaño de la letra"
                    valor={elemento.tamano}
                    min={LIMITES_TEXTO.tamano.min}
                    max={LIMITES_TEXTO.tamano.max}
                    paso={0.5}
                    alCambiar={(v) => actualizarElemento(indice, { tamano: v })}
                  />
                  <div className="field">
                    <label htmlFor={`el_peso_${indice}`}>Grosor</label>
                    <select
                      id={`el_peso_${indice}`}
                      value={elemento.peso}
                      onChange={(e) =>
                        actualizarElemento(indice, {
                          peso: Number(e.target.value) as 400 | 600 | 700,
                        })
                      }
                    >
                      <option value={400}>Normal</option>
                      <option value={600}>Semi negrita</option>
                      <option value={700}>Negrita</option>
                    </select>
                  </div>
                </>
              )}

              {elemento.tipo === 'franja' && (
                <>
                  <Deslizador
                    id={`el_ancho_${indice}`}
                    etiqueta="Ancho"
                    valor={elemento.ancho}
                    min={LIMITES_FRANJA.lado.min}
                    max={LIMITES_FRANJA.lado.max}
                    paso={0.5}
                    alCambiar={(v) => actualizarElemento(indice, { ancho: v })}
                  />
                  <Deslizador
                    id={`el_alto_${indice}`}
                    etiqueta="Alto"
                    valor={elemento.alto}
                    min={LIMITES_FRANJA.lado.min}
                    max={LIMITES_FRANJA.lado.max}
                    paso={0.5}
                    alCambiar={(v) => actualizarElemento(indice, { alto: v })}
                  />
                  <Deslizador
                    id={`el_radio_${indice}`}
                    etiqueta="Esquinas redondeadas"
                    valor={elemento.radio}
                    min={LIMITES_FRANJA.radio.min}
                    max={LIMITES_FRANJA.radio.max}
                    paso={1}
                    alCambiar={(v) => actualizarElemento(indice, { radio: v })}
                  />
                </>
              )}

              <Deslizador
                id={`el_x_${indice}`}
                etiqueta="Posición horizontal"
                valor={elemento.x}
                min={0}
                max={100}
                paso={0.5}
                alCambiar={(v) => actualizarElemento(indice, { x: v })}
              />
              <Deslizador
                id={`el_y_${indice}`}
                etiqueta="Posición vertical"
                valor={elemento.y}
                min={0}
                max={100}
                paso={0.5}
                alCambiar={(v) => actualizarElemento(indice, { y: v })}
              />

              <div className="field">
                <label htmlFor={`el_color_${indice}`}>Color</label>
                <div className="selector-color">
                  <input
                    id={`el_color_${indice}`}
                    type="color"
                    value={hexDesdeRgb(elemento.color)}
                    onChange={(e) =>
                      actualizarElemento(indice, {
                        // Igual que los selectores de arriba: si el navegador manda algo que
                        // rgbDesdeTexto no entiende, se conserva el color anterior en vez de
                        // guardar un negro que el dueño no eligió.
                        color: rgbDesdeTexto(e.target.value) ?? elemento.color,
                      })
                    }
                  />
                  <span className="hex">{hexDesdeRgb(elemento.color)}</span>
                </div>
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-borde"
              onClick={agregarTexto}
              disabled={elementos.length >= MAX_ELEMENTOS}
            >
              <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">title</span>
              Agregar texto
            </button>
            <button
              type="button"
              className="btn-borde"
              onClick={agregarFranja}
              disabled={elementos.length >= MAX_ELEMENTOS}
            >
              <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">rectangle</span>
              Agregar franja de color
            </button>
          </div>
          {elementos.length >= MAX_ELEMENTOS && (
            <p className="admin-fila-slug" style={{ marginTop: 8 }}>
              Llegaste al máximo de {MAX_ELEMENTOS} agregados.
            </p>
          )}
          <p className="admin-fila-slug" style={{ marginTop: 8 }}>
            Las franjas van siempre por debajo del QR, así que aunque las pongas encima el código se
            sigue escaneando. Un texto sí lo puede tapar: mirá la vista previa antes de imprimir.
          </p>
        </fieldset>

        <button className="btn-acento" type="submit" disabled={guardando}>
          <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">check_circle</span>
          {guardando ? 'Guardando…' : 'Guardar cartel'}
        </button>
        {estadoGuardar && 'ok' in estadoGuardar && (
          <p className="nota" style={{ textAlign: 'left' }}>Listo. Ya podés descargarlo para imprimir.</p>
        )}
      </form>

      <section className="panel">
        <p className="titulo-seccion" style={{ marginBottom: 14 }}>Logo del cartel</p>
        <p className="admin-fila-slug" style={{ marginTop: 0, marginBottom: 12 }}>
          {tieneLogoPropio
            ? 'Este cartel usa un logo propio.'
            : 'Este cartel usa el logo de tu marca. Podés poner otro solo para el cartel.'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <form action={ejecutarSubirLogo}>
            <input
              ref={inputLogoRef}
              type="file"
              name="archivo"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            />
            {/* La subida arranca sola al elegir el archivo, igual que en Marca: pedir un segundo
                click en "Subir" hacía creer que ya estaba aplicado cuando no. */}
            <button
              type="button"
              className="btn-borde"
              disabled={subiendoLogo}
              onClick={() => inputLogoRef.current?.click()}
            >
              {subiendoLogo ? 'Subiendo…' : tieneLogoPropio ? 'Cambiar logo' : 'Subir un logo para el cartel'}
            </button>
          </form>
          {tieneLogoPropio && (
            <form action={ejecutarQuitarLogo}>
              <button type="submit" className="btn-borde" disabled={quitandoLogo}>
                {quitandoLogo ? 'Quitando…' : 'Quitar (volver al logo de mi marca)'}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="panel">
        <p className="titulo-seccion" style={{ marginBottom: 14 }}>Descargar para imprimir</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {/* <a> y no <Link>: esto no navega a una pantalla, descarga un archivo del servidor. */}
          <a
            className="btn-borde"
            href={`/comercio/programas/${programaId}/cartel/descargar?formato=${formato}&tipo=pdf`}
          >
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">picture_as_pdf</span>
            PDF para imprenta
          </a>
          <a
            className="btn-borde"
            href={`/comercio/programas/${programaId}/cartel/descargar?formato=${formato}&tipo=png`}
          >
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">image</span>
            Imagen PNG
          </a>
        </div>
        <p className="admin-fila-slug" style={{ marginTop: 10 }}>
          El archivo sale con lo último que guardaste, en el tamaño elegido arriba. Si acabás de
          cambiar algo, guardá primero.
        </p>
      </section>

      {error && <p className="alerta" role="alert">{error}</p>}
    </div>
  );
}
