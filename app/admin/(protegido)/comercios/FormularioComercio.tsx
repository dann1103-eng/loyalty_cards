'use client';

import { useState, type ChangeEvent } from 'react';
import { useActionState } from 'react';
import type { EstadoFormulario } from './actions';
import { TIPOS_TARJETA, type DatosComercio } from '@/lib/comercios/guardarComercio';
import { frentePase } from '@/lib/tarjetas/frentePase';
import { rotuloTarjeta } from '@/lib/tarjetas/textosPorTipo';

// Meta de DEMOSTRACIÓN para la vista previa de sellos. El alta no pregunta la meta —
// crearProgramaPrincipal inserta el programa con sello_meta null y el dueño la elige después en
// Marca—, así que este 10 no sale de ningún dato: es el mismo ejemplo que ya estaba cableado acá.
const META_SELLOS_DEMO = 10;

type Valores = {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string;
  strip_url: string;
  hero_url: string;
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

  // El frente de la tarjeta sale de frentePase, la MISMA función que arma el pass real y las otras
  // dos réplicas (el editor de marca del dueño y la pantalla de registro del cliente). Antes acá
  // vivía un `esSellos ? '0 de 10' : '0'` propio, y por eso dar de alta una MEMBRESÍA —— o un cupón,
  // o un descuento —— dibujaba "0 Puntos": una unidad que esa tarjeta no tiene y un número que su
  // pase nunca va a mostrar. Con esos tipos frentePase devuelve los dos campos en null y el bloque
  // del contador no se dibuja, igual que en la billetera.
  const frente = frentePase({
    tipoTarjeta: valores.tipo_tarjeta,
    // Tarjeta recién emitida: el preview muestra lo que va a ver el primer cliente del comercio.
    puntos: 0,
    selloMeta: valores.tipo_tarjeta === 'sellos' ? META_SELLOS_DEMO : null,
    // `hayGrilla` le pregunta a frentePase si la palabra "sellos" YA se ve en otra parte del frente
    // (en el pase, la grilla de círculos de la franja). Acá se ve: esta tarjeta imprime la etiqueta
    // en su propio renglón, el <span> de abajo. Con `false`, frentePase la metería ADEMÁS dentro del
    // valor ("0 de 10 sellos") y quedaría repetida y, a los 2.2rem de mono de .cardface-points b,
    // más ancha que la tarjeta —— que recorta con overflow:hidden.
    hayGrilla: true,
  });

  // La tarjeta de FM tiene UN solo renglón de contador, así que da lo mismo en qué campo lo haya
  // puesto frentePase; en los tipos sin contador los dos son null y no se dibuja nada.
  const contador = frente.primario ?? frente.secundario;

  return (
    <>
      {/* Vista previa EN VIVO: los campos son controlados, así que la tarjeta reacciona al tipeo.
          Un valor de color a medio escribir es inválido en CSS y el navegador simplemente lo
          ignora (conserva el anterior) — no hace falta validar aquí. */}
      <div className="cardface reveal d2" style={{ background: valores.color_fondo, color: valores.color_texto, maxWidth: 360, margin: '0 auto 22px' }}>
        {/* El rótulo de arriba sale del catálogo (rotuloTarjeta), no de un literal. Antes decía
            "Comercio afiliado", que es la única de las tres réplicas que dice algo que la tarjeta
            del cliente nunca diría —— y, sobre todo, en los seis tipos sin contador el rótulo es lo
            ÚNICO que cambia al elegir otro tipo: sin él, una membresía y un cupón se ven idénticos y
            el operador de FM se queda sin señal de que el <select> hizo algo. */}
        <div className="cardface-top" style={{ color: valores.color_label }}>
          <span>{rotuloTarjeta(valores.tipo_tarjeta)}</span>
          <span>Cardly SV</span>
        </div>
        <div className="cardface-name">{valores.nombre || 'Nombre del comercio'}</div>
        {contador && (
          <div className="cardface-points">
            <b>{contador.valor}</b>
            <span style={{ color: valores.color_label }}>{contador.etiqueta}</span>
          </div>
        )}
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
