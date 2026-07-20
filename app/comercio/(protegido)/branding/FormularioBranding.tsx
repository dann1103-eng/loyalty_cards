'use client';

import { useState, type ChangeEvent, type ReactNode } from 'react';
import { useActionState } from 'react';
import { accionGuardarBranding, type EstadoBranding } from './actions';

type Props = {
  nombreComercio: string;
  esSellos: boolean;
  inicial: {
    color_fondo: string;
    color_texto: string;
    color_label: string;
    sello_meta: string;
  };
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

export default function FormularioBranding({ nombreComercio, esSellos, inicial, urls, subidas }: Props) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoBranding, FormData>(
    accionGuardarBranding,
    undefined,
  );

  // Estado controlado: el texto acepta rgb() o hex (los e2e escriben rgb); el picker habla hex.
  const [valores, setValores] = useState({
    color_fondo: inicial.color_fondo,
    color_texto: inicial.color_texto,
    color_label: inicial.color_label,
    sello_meta: inicial.sello_meta,
  });

  const cambiarTexto =
    (campo: 'color_fondo' | 'color_texto' | 'color_label' | 'sello_meta') =>
    (e: ChangeEvent<HTMLInputElement>) =>
      setValores((v) => ({ ...v, [campo]: e.target.value }));

  const cambiarPicker =
    (campo: 'color_fondo' | 'color_texto' | 'color_label') =>
    (e: ChangeEvent<HTMLInputElement>) => {
      const rgb = rgbDesdeTexto(e.target.value);
      if (rgb) setValores((v) => ({ ...v, [campo]: rgb }));
    };

  // Para pintar la vista previa usamos lo que haya válido; si el texto está a medio escribir,
  // caemos al último color válido convertible (hexDesdeRgb tolera ambos formatos).
  const fondo = rgbDesdeTexto(valores.color_fondo) ?? inicial.color_fondo;
  const texto = rgbDesdeTexto(valores.color_texto) ?? inicial.color_texto;
  const label = rgbDesdeTexto(valores.color_label) ?? inicial.color_label;

  const meta = Number(valores.sello_meta) > 0 ? Math.min(20, Number(valores.sello_meta)) : 10;
  const llenos = Math.min(7, meta);

  return (
    <div className="branding-grid">
      {/* -------- VISTA PREVIA EN VIVO (sticky en desktop) -------- */}
      <div className="branding-preview reveal d1">
        <p className="titulo-seccion" style={{ marginBottom: 12 }}>Vista previa en vivo</p>
        <div className="cardface" style={{ background: fondo, color: texto }}>
          {urls.hero && (
            // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
            <img className="cardface-fondo" src={urls.hero} alt="" aria-hidden="true" />
          )}
          <div className="cardface-top" style={{ color: label }}>
            <span>Comercio afiliado</span>
            <span>FM Lealtad</span>
          </div>
          <div className="cardface-logo">
            {urls.logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
              <img src={urls.logo} alt={`Logo de ${nombreComercio}`} />
            ) : (
              <span className="icono icono-lleno" style={{ color: '#111' }} aria-hidden="true">storefront</span>
            )}
          </div>
          <div className="cardface-name">{nombreComercio}</div>

          {esSellos ? (
            <>
              <div className="sello-grid">
                {Array.from({ length: meta }, (_, i) => (
                  <div
                    key={`${meta}-${i}`}
                    className={`sello${i < llenos ? ' lleno' : ''}`}
                    style={{
                      animationDelay: `${i * 0.04}s`,
                      ...(i < llenos ? { background: label, boxShadow: `0 0 12px ${hexDesdeRgb(label)}66` } : {}),
                    }}
                  >
                    {i < llenos ? (
                      urls.selloIcono ? (
                        // eslint-disable-next-line @next/next/no-img-element -- vista previa simple
                        <img src={urls.selloIcono} alt="" aria-hidden="true" style={{ width: '62%', height: '62%', objectFit: 'contain' }} />
                      ) : (
                        <span className="icono icono-lleno" style={{ fontSize: 15, color: fondo }} aria-hidden="true">verified</span>
                      )
                    ) : (
                      <span className="punto" />
                    )}
                  </div>
                ))}
              </div>
              <div className="cardface-points">
                <b>{llenos} de {meta}</b>
                <span style={{ color: label }}>sellos</span>
              </div>
            </>
          ) : (
            <div className="cardface-points">
              <b>0</b>
              <span style={{ color: label }}>Puntos</span>
            </div>
          )}
        </div>
        <p className="nota" style={{ textAlign: 'center' }}>
          Maqueta ilustrativa: el pass real lo firma Apple con estos mismos colores.
        </p>
      </div>

      {/* -------- EDITOR -------- */}
      <div className="branding-editor">
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
                  value={hexDesdeRgb(valores[campo])}
                  onChange={cambiarPicker(campo)}
                />
                <div style={{ flex: 1 }}>
                  <input
                    id={campo}
                    name={campo}
                    value={valores[campo]}
                    onChange={cambiarTexto(campo)}
                    placeholder="rgb(19, 19, 21)"
                    required
                    style={{ width: '100%' }}
                  />
                  <p className="hex" style={{ marginTop: 4 }}>{hexDesdeRgb(valores[campo])}</p>
                </div>
              </div>
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
            </div>
          )}

          <button className="btn-acento" type="submit" disabled={pendiente} style={{ marginTop: 6 }}>
            <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">check_circle</span>
            {pendiente ? 'Publicando…' : 'Publicar cambios'}
          </button>
          {estado && 'error' in estado && (
            <p className="alerta" role="alert">{estado.error}</p>
          )}
          {estado && 'ok' in estado && (
            <p className="nota" style={{ textAlign: 'left' }}>Branding guardado. Los passes nuevos ya salen con estos colores.</p>
          )}
        </form>
      </div>
    </div>
  );
}
