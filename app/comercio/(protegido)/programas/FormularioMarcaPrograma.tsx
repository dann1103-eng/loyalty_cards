'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { accionGuardarBrandingPrograma, type EstadoPrograma } from './actions';
import { NIVELES_DIFUMINADO, type NivelDifuminado } from '@/lib/apple/difuminadoFranja';
import type { BrandingProgramaFila } from '@/lib/comercio/guardarBrandingPrograma';
import SubidaImagenPrograma from './SubidaImagenPrograma';

const ETIQUETAS_DIFUMINADO: Record<NivelDifuminado, string> = {
  ninguno: 'Ninguno (corte seco)',
  sutil: 'Sutil',
  medio: 'Medio',
  fuerte: 'Fuerte',
};

// Lo que el programa hereda cuando no define nada propio: el branding del comercio. Se usa como
// PLACEHOLDER de cada campo para que el dueño vea qué está usando hoy, en vez de una caja vacía
// que no le dice si el programa está heredando o si simplemente no hay nada configurado.
export interface MarcaHeredada {
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  difuminadoFranja: string;
}

const CAMPOS_COLOR = [
  ['color_fondo', 'Color de fondo', 'colorFondo'],
  ['color_texto', 'Color de texto', 'colorTexto'],
  ['color_label', 'Color de etiqueta', 'colorLabel'],
] as const;

// Los TRES campos que Google guarda en la LoyaltyClass y que, por lo tanto, obligan a crearle al
// programa su propia tarjeta en Google — un recurso PERMANENTE: la API no tiene delete. Los otros
// (color de texto, etiqueta, franja, ícono de sello, difuminado) son gratis y reversibles.
const AVISO_IRREVERSIBLE =
  'Ojo: el color de fondo, el logo y la imagen de portada crean la tarjeta de este programa en ' +
  'Google Wallet, y eso NO SE PUEDE DESHACER — Google no permite borrar una tarjeta ya creada. ' +
  'Los demás campos (color de texto, etiqueta, franja, ícono de sello y difuminado) se pueden ' +
  'cambiar y deshacer cuantas veces quieras.';

export default function FormularioMarcaPrograma({
  programaId,
  nombrePrograma,
  esSellos,
  marca,
  heredada,
}: {
  programaId: string;
  nombrePrograma: string;
  esSellos: boolean;
  marca: BrandingProgramaFila;
  heredada: MarcaHeredada;
}) {
  const [estado, ejecutar, pendiente] = useActionState<EstadoPrograma, FormData>(
    accionGuardarBrandingPrograma.bind(null, programaId),
    undefined,
  );

  const aTexto = (valor: string | number | null) => (valor === null ? '' : String(valor));

  // Mismo patrón que FormularioConfiguracionPrograma: campos NO controlados con `key`, porque esto
  // es EDICIÓN de algo ya guardado y con estado controlado el reset posterior al Server Action
  // desincroniza los campos del valor real.
  const clave = [
    marca.brandingPropio,
    marca.colorFondo,
    marca.colorTexto,
    marca.colorLabel,
    marca.difuminadoFranja,
    marca.selloMeta,
  ].join('|');

  // El interruptor SÍ es controlado: habilita y deshabilita los campos de abajo en vivo, sin ir al
  // servidor. Se resincroniza cuando cambia lo guardado con el patrón oficial de React de ajustar
  // estado durante el render (no con un useEffect, que renderizaría una vez con el valor viejo).
  const [claveVista, setClaveVista] = useState(clave);
  const [propio, setPropio] = useState(marca.brandingPropio);
  if (claveVista !== clave) {
    setClaveVista(clave);
    setPropio(marca.brandingPropio);
  }

  // Ningún campo de los tres que crean la clase de Google está definido todavía: recién ahí el
  // guardado cruza la línea de lo irreversible y vale la pena frenar al dueño con un confirm.
  const cruzaLaLinea = marca.colorFondo === null && marca.logoUrl === null && marca.heroUrl === null;

  const alEnviar = (e: React.FormEvent<HTMLFormElement>) => {
    if (!propio || !cruzaLaLinea) return;
    const fondo = new FormData(e.currentTarget).get('color_fondo');
    if (!String(fondo ?? '').trim()) return;
    if (
      !window.confirm(
        `Darle color de fondo propio a "${nombrePrograma}" crea su tarjeta en Google Wallet, y eso NO SE PUEDE DESHACER: Google no permite borrarla una vez creada. ¿Seguimos?`,
      )
    ) {
      e.preventDefault();
    }
  };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--linea)', paddingTop: 14 }}>
      <p className="titulo-seccion" style={{ marginBottom: 10 }}>Marca de este programa</p>

      <form key={clave} action={ejecutar} onSubmit={alEnviar}>
        <label
          className="field"
          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}
        >
          <input
            type="checkbox"
            name="branding_propio"
            checked={propio}
            onChange={(e) => setPropio(e.target.checked)}
            style={{ width: 'auto', marginTop: 3 }}
          />
          <span>
            Usar marca propia
            <span className="admin-fila-slug" style={{ display: 'block', marginTop: 2 }}>
              Apagado, este programa se ve igual que el resto de tu negocio. Encendido, usa lo que
              cargues acá abajo y hereda del comercio todo lo que dejes vacío.
            </span>
          </span>
        </label>

        <p className="field-aviso" style={{ color: 'var(--texto-2)', marginBottom: 12 }}>
          {AVISO_IRREVERSIBLE}
        </p>

        {CAMPOS_COLOR.map(([campo, etiqueta, llave]) => {
          const valor = aTexto(marca[llave]);
          return (
            <div className="field" key={campo}>
              <label htmlFor={`${campo}-${programaId}`}>{etiqueta}</label>
              <input
                id={`${campo}-${programaId}`}
                name={propio ? campo : undefined}
                defaultValue={valor}
                disabled={!propio}
                placeholder={aTexto(heredada[llave]) || 'rgb(19, 19, 21)'}
              />
              {/* Un <input disabled> NO se envía. Sin este espejo oculto, guardar con el
                  interruptor apagado BORRARÍA los colores que el dueño ya había configurado, y
                  volver a encenderlo le devolvería un programa en blanco — justo lo contrario de
                  lo que promete brandingEfectivo ("apagarlo no obliga a limpiar cada columna"). */}
              {!propio && <input type="hidden" name={campo} value={valor} />}
            </div>
          );
        })}

        {esSellos && (
          <div className="field">
            <label htmlFor={`sello_meta-${programaId}`}>Meta de sellos</label>
            <input
              id={`sello_meta-${programaId}`}
              name="sello_meta"
              type="number"
              min="1"
              max="20"
              step="1"
              inputMode="numeric"
              placeholder="10"
              defaultValue={aTexto(marca.selloMeta)}
              className="dato-mono"
            />
            {/* La meta NO se deshabilita con el interruptor: no es marca, es la mecánica del
                programa, y el pase la lee de acá tenga o no marca propia. Si colgara del
                interruptor, un segundo programa de sellos no tendría forma de fijar su meta. */}
            <p className="field-aviso" style={{ color: 'var(--texto-2)' }}>
              Cuántos sellos necesita el cliente para el premio de este programa. Vale aunque no uses
              marca propia.
            </p>
          </div>
        )}

        <div className="field">
          <label htmlFor={`difuminado_franja-${programaId}`}>Difuminado de la foto de fondo</label>
          <select
            id={`difuminado_franja-${programaId}`}
            name={propio ? 'difuminado_franja' : undefined}
            defaultValue={marca.difuminadoFranja ?? ''}
            disabled={!propio}
          >
            <option value="">Heredar del comercio ({heredada.difuminadoFranja})</option>
            {NIVELES_DIFUMINADO.map((nivel) => (
              <option key={nivel} value={nivel}>{ETIQUETAS_DIFUMINADO[nivel]}</option>
            ))}
          </select>
          {!propio && (
            <input type="hidden" name="difuminado_franja" value={marca.difuminadoFranja ?? ''} />
          )}
        </div>

        <button className="btn-borde" type="submit" disabled={pendiente}>
          {pendiente ? 'Guardando…' : 'Guardar marca'}
        </button>
        {estado && 'error' in estado && <p className="alerta" role="alert">{estado.error}</p>}
        {estado && 'ok' in estado && (
          <p className="admin-fila-slug" role="status" style={{ marginTop: 8 }}>
            Guardado. Las tarjetas de este programa ya se están actualizando.
          </p>
        )}
      </form>

      {/* Las imágenes van FUERA del formulario de arriba: cada una es su propio Server Action (se
          suben solas al elegir el archivo), y un <form> anidado no es HTML válido. */}
      <p className="titulo-seccion" style={{ margin: '16px 0 10px' }}>Imágenes de este programa</p>
      {!propio && (
        <p className="admin-fila-slug" style={{ marginBottom: 10 }}>
          Con la marca propia apagada, estas imágenes quedan guardadas pero el cliente sigue viendo
          las del comercio.
        </p>
      )}
      <SubidaImagenPrograma
        programaId={programaId}
        campo="logo"
        etiqueta="Logo"
        urlActual={marca.logoUrl}
        urlHeredada={heredada.logoUrl}
        avisaIrreversible={cruzaLaLinea}
      />
      <SubidaImagenPrograma
        programaId={programaId}
        campo="hero"
        etiqueta="Imagen de portada"
        urlActual={marca.heroUrl}
        urlHeredada={heredada.heroUrl}
        avisaIrreversible={cruzaLaLinea}
      />
      <SubidaImagenPrograma
        programaId={programaId}
        campo="strip"
        etiqueta="Foto de la franja"
        urlActual={marca.stripUrl}
        urlHeredada={heredada.stripUrl}
        avisaIrreversible={false}
      />
      {esSellos && (
        <SubidaImagenPrograma
          programaId={programaId}
          campo="sello_icono"
          etiqueta="Ícono del sello"
          urlActual={marca.selloIconoUrl}
          urlHeredada={heredada.selloIconoUrl}
          avisaIrreversible={false}
        />
      )}
    </div>
  );
}
