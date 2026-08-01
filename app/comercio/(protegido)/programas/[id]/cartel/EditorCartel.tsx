'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { construirCartelSvg } from '@/lib/comercio/cartel/plantillas';
import type { DatosCartel, FormatoCartel, PlantillaCartel } from '@/lib/comercio/cartel/tipos';
import { PLANTILLAS_CARTEL, FORMATOS_CARTEL } from '@/lib/comercio/cartel/tipos';
import { hexDesdeRgb, rgbDesdeTexto } from '@/lib/comercio/colorHex';
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

export default function EditorCartel({
  programaId,
  datosResueltos,
  marcaEfectiva,
  personalizadoInicial,
  tieneLogoPropio,
}: {
  programaId: string;
  datosResueltos: DatosCartel;
  /* Los colores a los que vuelve el cartel cuando se apaga la personalización: la marca EFECTIVA
     del programa (la suya si tiene propia, la del negocio si hereda), ya resuelta en el servidor. */
  marcaEfectiva: { colorFondo: string; colorTexto: string; colorLabel: string };
  personalizadoInicial: boolean;
  tieneLogoPropio: boolean;
}) {
  const [plantilla, setPlantilla] = useState<PlantillaCartel>(datosResueltos.plantilla);
  const [personalizar, setPersonalizar] = useState(personalizadoInicial);
  const [colorFondo, setColorFondo] = useState(datosResueltos.colorFondo);
  const [colorTexto, setColorTexto] = useState(datosResueltos.colorTexto);
  const [colorLabel, setColorLabel] = useState(datosResueltos.colorLabel);
  const [textoCta, setTextoCta] = useState(datosResueltos.textoCta);
  const [textoTeaser, setTextoTeaser] = useState(datosResueltos.textoTeaser ?? '');
  const [formato, setFormato] = useState<FormatoCartel>('sticker');
  const [previewSvg, setPreviewSvg] = useState<string>('');

  const inputLogoRef = useRef<HTMLInputElement>(null);

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
    }),
    [datosResueltos, plantilla, colorFondo, colorTexto, colorLabel, textoCta, textoTeaser],
  );

  // Vista previa en vivo: la MISMA función que arma el PNG/PDF exportado (construirCartelSvg), sin
  // ida y vuelta al servidor. Es async porque `qrcode` expone una API por promesa (no hace ningún
  // fetch de red). DEBE ser useEffect y no useMemo: solo useEffect ejecuta la función de limpieza
  // que retorna — con useMemo, `vigente` nunca se pondría en false y una respuesta lenta y obsoleta
  // podría pisar una vista previa más nueva ante cambios rápidos de plantilla/color/formato.
  useEffect(() => {
    let vigente = true;
    construirCartelSvg(datosVivos, formato).then((svg) => {
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
            {/* El SVG lo construye construirCartelSvg, que escapa TODO texto libre con escaparXml
                (ver plantillas.ts): no hay markup del dueño llegando acá sin pasar por ahí.
                `cartel-preview` es lo que lo achica a la caja (el SVG trae su tamaño en mm). */}
            <div
              className="cartel-preview"
              style={{ maxWidth: 260, width: '100%' }}
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </div>
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
