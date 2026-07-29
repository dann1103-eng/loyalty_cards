import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import estilos from './_inicio/inicio.module.css';
import CarruselTarjetas from './_inicio/CarruselTarjetas';
import FormularioDemo from './_inicio/FormularioDemo';
import { MARCA } from '@/lib/marca';
import { TIPOS } from '@/lib/tarjetas/tipos';

// Página de entrada de cardly-sv.site. Le habla a DUEÑOS DE COMERCIO que todavía no son clientes:
// el cliente final nunca llega acá, llega por el código de su propio comercio.
//
// Rediseño 2026-07-29 a partir de un mockup que trajo el dueño: pasa de un solo acento naranja
// ("campo de brasa") a una paleta "Full palette" de afiche de calle (noche + lima + violeta),
// alternando bandas oscuras y claras sección por sección. Ver DESIGN.md § Página pública para la
// escena que decide la paleta y qué se conservó del diseño anterior (el carrusel de tarjetas, el
// formulario de demo con su antibot, el principio de servirse sin JavaScript).
//
// TRES DIFERENCIAS A PROPÓSITO respecto del mockup original, documentadas acá porque no son un
// detalle visual sino una decisión de contenido:
// 1. Sin contadores inventados ("+1,200 comercios..."): PRODUCT.md los descarta explícitamente
//    ("son números de piloto y restan"). La franja de confianza dice tres cosas ciertas hoy.
// 2. El pie usa SOLO datos reales de lib/marca.ts. El mockup traía un teléfono argentino y un
//    correo genérico que no son de Cardly SV.
// 3. Ningún botón promete alta instantánea: todos apuntan a #demo, el formulario real que ya
//    guarda prospectos (ver acciones.ts). "Creá tu tarjeta gratis" se volvió "Agendá tu demo
//    gratis" por la misma razón.

export const metadata: Metadata = {
  title: `${MARCA.nombre} — Tarjetas de lealtad digitales para tu negocio`,
  description:
    'Sellos, puntos, cashback, gift card y más, directo en la billetera del teléfono de tus clientes. Sin apps que instalar y sin plásticos que perder. Agendá una demo.',
};

const PASOS = [
  {
    titulo: 'Armás tu tarjeta',
    texto:
      'Elegís tus colores, subís tu logo y decidís cómo premiás: sellos, puntos, cashback o lo que más te sirva. En minutos y sin diseñador.',
  },
  {
    titulo: 'Tu cliente la guarda',
    texto:
      'Escanea el código que ponés en el mostrador, deja su nombre y su teléfono, y la tarjeta le queda en el teléfono. No instala nada.',
  },
  {
    titulo: 'Sumás en cada visita',
    texto:
      'Tu cajero escanea la tarjeta desde su propio acceso y el saldo se actualiza al instante, en el bolsillo del cliente.',
  },
];

const CONFIANZA = [
  {
    titulo: 'Apple Wallet y Google Wallet',
    texto: 'Sin apps que instalar, sin plásticos que perder.',
  },
  {
    titulo: `${TIPOS.length} tipos de tarjeta`,
    texto: TIPOS.map((tipo) => tipo.etiqueta).join(', ') + '.',
  },
  {
    titulo: 'Tu marca, no la nuestra',
    texto: 'Tus colores y tu logo en la pantalla de cada cliente.',
  },
];

// Un color por tipo, solo para diferenciar las fichas a simple vista: no es dato de negocio, por
// eso vive acá y no en lib/tarjetas/tipos.ts.
const COLOR_TIPO: Record<string, string> = {
  puntos: '#7c9eff',
  sellos: '#f4a259',
  prepago: '#5bc0be',
  gift_card: '#e39bda',
  cashback: '#8bd67e',
  cupon: '#ff8a65',
  membresia: '#8b7cf6',
  descuento: '#ffce54',
};

const DOLORES = [
  {
    titulo: 'Sellos falsificados',
    texto: 'Cualquiera con un sello de goma te vacía el programa. Acá cada acreditación queda firmada por el cajero que la hizo.',
  },
  {
    titulo: 'Sin control de tus cajeros',
    texto: 'No sabés quién dio de más ni cuándo. Poné un tope diario por cliente y mirá un reporte por cajero.',
  },
  {
    titulo: 'Excel y cuaderno',
    texto: 'Datos sueltos, sin respaldo, que se pierden con el teléfono que se rompe o el cajero que se va.',
  },
  {
    titulo: 'Grupos de WhatsApp',
    texto: 'Mensajes que nadie lee dos veces, y ninguna forma de saber a quién le llegaron de verdad.',
  },
  {
    titulo: 'No sabés cuándo tu cliente está cerca',
    texto: 'Con geolocalización por sucursal, el aviso le llega solo cuando pasa cerca de tu local.',
  },
  {
    titulo: 'Tu cliente es de la plataforma, no tuyo',
    texto: 'Tus colores y tu logo en la billetera, no los nuestros. La relación es con tu negocio.',
  },
];

interface PlanPrecio {
  id: string;
  nombre: string;
  precio: number;
  caracteristicas: string[];
  cta: string;
  destacado?: boolean;
  etiqueta?: string;
}

const PLANES_PRECIO: PlanPrecio[] = [
  {
    id: 'starter',
    nombre: 'Starter',
    precio: 29,
    caracteristicas: ['1 negocio', 'Hasta 500 clientes', 'Soporte por WhatsApp'],
    cta: 'Quiero Starter',
  },
  {
    id: 'growth',
    nombre: 'Growth',
    precio: 49,
    destacado: true,
    etiqueta: 'El más elegido',
    caracteristicas: [
      'Hasta 2 negocios o sucursales',
      'Hasta 2,500 clientes',
      'Promos push ilimitadas',
      'Reportes mensuales',
    ],
    cta: 'Quiero Growth',
  },
  {
    id: 'pro',
    nombre: 'Pro',
    precio: 89,
    caracteristicas: [
      'Negocios y sucursales ilimitados',
      'Clientes ilimitados',
      'Soporte prioritario',
      'Integraciones a medida',
    ],
    cta: 'Hablemos',
  },
];

const PREGUNTAS = [
  {
    pregunta: '¿Mis clientes necesitan bajarse una app?',
    respuesta: 'No. La tarjeta vive en Apple Wallet o Google Wallet, que ya vienen instalados en cualquier teléfono.',
  },
  {
    pregunta: '¿Funciona en Android y iPhone?',
    respuesta: 'Sí, los dos: Apple Wallet de un lado, Google Wallet del otro, la misma tarjeta.',
  },
  {
    pregunta: '¿Puedo cambiar de plan después?',
    respuesta: 'Cuando quieras, desde tu panel. Subís o bajás de plan sin escribirnos un correo.',
  },
  {
    pregunta: '¿Qué pasa si quiero cancelar?',
    respuesta: 'Cancelás cuando quieras, sin permanencia ni penalidad.',
  },
  {
    pregunta: '¿Puedo probar antes de pagar?',
    respuesta: 'Sí. Agendá una demo y te mostramos tu tarjeta funcionando con tus colores, antes de que pagues nada.',
  },
];

export default function Inicio() {
  return (
    <div className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <div className={`${estilos.envoltura} ${estilos.cabeceraFila}`}>
          <span className={estilos.marca}>
            <Image
              className={estilos.marcaPunto}
              src="/marca/icono-badge.svg"
              alt=""
              aria-hidden="true"
              width={26}
              height={26}
              unoptimized
              priority
            />
            {MARCA.nombre}
          </span>
          <nav className={estilos.navCabecera}>
            <a className={estilos.enlaceCabecera} href="#como-funciona">
              Cómo funciona
            </a>
            <a className={estilos.enlaceCabecera} href="#tarjetas">
              Tarjetas
            </a>
            <a className={estilos.enlaceCabecera} href="#precios">
              Precios
            </a>
            <a className={estilos.enlaceCabecera} href="#preguntas">
              Preguntas
            </a>
            <a className={estilos.botonCabecera} href="#demo">
              ¿Vos in?
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className={estilos.hero}>
          <div className={`${estilos.envoltura} ${estilos.heroRejilla}`}>
            <div className={estilos.heroTexto}>
              <p className={estilos.heroPregon}>¿Vos in?</p>
              <h1 className={estilos.heroTitulo}>
                Tu club.
                <br />
                <em>Tus reglas.</em>
              </h1>
              <p className={estilos.heroLinea}>
                Sellos, puntos, cashback o lo que decidas: tus clientes lo llevan en la billetera
                del teléfono, y vos ponés el límite de cuánto dar y a quién.
              </p>
              <a className={estilos.botonHero} href="#demo">
                Agendá tu demo gratis
              </a>
              <p className={estilos.heroNota}>
                Te la mostramos con tus colores y tu logo, sin compromiso.
              </p>

              <span className={`${estilos.pegatina} ${estilos.pegatinaUno}`} aria-hidden="true">
                100% digital
              </span>
              <span className={`${estilos.pegatina} ${estilos.pegatinaDos}`} aria-hidden="true">
                {TIPOS.length} tipos de tarjeta
              </span>
            </div>

            {/* En pantalla angosta el abanico se sale de la envoltura y toca los dos bordes: es la
                única pieza de la página que gana con el ancho completo. */}
            <div className={estilos.heroVitrina}>
              <CarruselTarjetas />
              <p className={estilos.pieVitrina}>
                Ejemplos que armamos nosotros, no clientes reales.
              </p>
            </div>
          </div>
        </section>

        <section className={estilos.confianza}>
          <div className={`${estilos.envoltura} ${estilos.confianzaFila}`}>
            {CONFIANZA.map((item) => (
              <div key={item.titulo} className={estilos.confianzaItem}>
                <b>{item.titulo}</b>
                <span>{item.texto}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          id="como-funciona"
          className={`${estilos.seccion} ${estilos.bandaClara}`}
        >
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>Cómo funciona</h2>
            <p className={estilos.textoSeccion}>Tres pasos, y el más largo lo hacés una sola vez.</p>
            {/* Lista ordenada de verdad: son pasos en secuencia, no tres features en una grilla.
                role="list" explícito porque Safari le quita la semántica de lista a cualquier lista
                con list-style: none, y el ordinal visible va con aria-hidden (leer "cero uno" no
                ayuda a nadie): sin el rol, quien no ve la pantalla pierde que son tres pasos. */}
            <ol className={estilos.pasos} role="list">
              {PASOS.map((paso, indice) => (
                <li key={paso.titulo} className={estilos.paso}>
                  <span className={estilos.pasoNumero} aria-hidden="true">{`0${indice + 1}`}</span>
                  <h3>{paso.titulo}</h3>
                  <p>{paso.texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="tarjetas" className={`${estilos.seccion} ${estilos.bandaClara}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>Tarjetas para cada negocio</h2>
            <p className={estilos.textoSeccion}>
              {TIPOS.length} formas de premiar a tu cliente, para el negocio que tengas.
            </p>
            <div className={estilos.tiposGrilla}>
              {TIPOS.map((tipo) => (
                <article key={tipo.valor} className={estilos.tipoFicha}>
                  <span
                    className={estilos.tipoBanda}
                    aria-hidden="true"
                    style={{ background: COLOR_TIPO[tipo.valor] }}
                  />
                  <h3 className={estilos.tipoNombre}>{tipo.etiqueta}</h3>
                  <div className={estilos.tipoPerforado}>
                    <p className={estilos.tipoDescripcion}>{tipo.descripcion}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>¿Seguís usando esto?</h2>
            <p className={estilos.textoSeccion}>
              Cada uno de estos problemas ya tiene una forma concreta de resolverse acá adentro.
            </p>
            <ul className={estilos.dolores} role="list">
              {DOLORES.map((dolor) => (
                <li key={dolor.titulo} className={estilos.dolor}>
                  <svg className={estilos.dolorX} viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div>
                    <h3>{dolor.titulo}</h3>
                    <p>{dolor.texto}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="precios" className={`${estilos.seccion} ${estilos.bandaClara}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>Planes para crecer</h2>
            <p className={estilos.textoSeccion}>
              Elegís según cuántos negocios y sucursales tenés. Cambiás de plan cuando quieras.
            </p>
            <div className={estilos.planesGrilla}>
              {PLANES_PRECIO.map((plan) => (
                <div
                  key={plan.id}
                  className={`${estilos.plan} ${plan.destacado ? estilos.planDestacado : ''}`}
                >
                  {plan.etiqueta && <span className={estilos.planEtiqueta}>{plan.etiqueta}</span>}
                  <p className={estilos.planNombre}>{plan.nombre}</p>
                  <p className={estilos.planPrecio}>
                    ${plan.precio}
                    <span>/mes</span>
                  </p>
                  <ul className={estilos.planLista} role="list">
                    {plan.caracteristicas.map((caracteristica) => (
                      <li key={caracteristica}>{caracteristica}</li>
                    ))}
                  </ul>
                  <a
                    className={plan.destacado ? estilos.botonHero : estilos.botonHeroContorno}
                    href="#demo"
                  >
                    {plan.cta}
                  </a>
                </div>
              ))}
            </div>
            <p className={estilos.planNota}>
              + instalación inicial de $149 (pago único, todos los planes).
            </p>
          </div>
        </section>

        <section id="preguntas" className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>Preguntas frecuentes</h2>
            <div className={estilos.preguntas}>
              {PREGUNTAS.map((item) => (
                <details key={item.pregunta} className={estilos.pregunta}>
                  <summary>
                    {item.pregunta}
                    <span className={estilos.preguntaSigno} aria-hidden="true" />
                  </summary>
                  <p>{item.respuesta}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="demo" className={`${estilos.seccion} ${estilos.cierre}`}>
          <div className={estilos.envoltura}>
            <div className={estilos.cierreCabecera}>
              <h2 className={estilos.cierreTitulo}>
                ¿Vos <em>in?</em>
              </h2>
              <p className={estilos.heroLinea}>
                Contanos de tu negocio y te escribimos para mostrarte cómo se vería tu tarjeta
                funcionando de verdad.
              </p>
            </div>

            <div className={estilos.cierreGrilla}>
              <ul className={estilos.cierreLista} role="list">
                <li>Te respondemos en menos de un día hábil.</li>
                <li>Te enseñamos tu tarjeta con tus colores y tu logo.</li>
                <li>Vemos juntos qué tipo de tarjeta te conviene.</li>
                <li>
                  ¿Preferís escribir vos?{' '}
                  <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>
                </li>
              </ul>
              <FormularioDemo />
            </div>
          </div>
        </section>
      </main>

      <footer className={estilos.pie}>
        <div className={`${estilos.envoltura} ${estilos.pieEnvoltura}`}>
          <div className={estilos.pieGrilla}>
            <div className={estilos.pieMarca}>
              <span className={estilos.marca}>
                <Image
                  className={estilos.marcaPunto}
                  src="/marca/icono-badge.svg"
                  alt=""
                  aria-hidden="true"
                  width={26}
                  height={26}
                  unoptimized
                />
                {MARCA.nombre}
              </span>
              <p>
                Tarjetas de lealtad digitales que viven en la billetera de tus clientes. Sin apps,
                sin plásticos.
              </p>
            </div>

            <div className={estilos.pieColumna}>
              <h3>Producto</h3>
              <ul>
                <li>
                  <a href="#como-funciona">Cómo funciona</a>
                </li>
                <li>
                  <a href="#tarjetas">Tarjetas</a>
                </li>
                <li>
                  <a href="#precios">Precios</a>
                </li>
                <li>
                  <a href="#preguntas">Preguntas</a>
                </li>
              </ul>
            </div>

            <div className={estilos.pieColumna}>
              <h3>Tu cuenta</h3>
              <ul>
                <li>
                  <Link href="/mi-tarjeta">Buscá tu tarjeta</Link>
                </li>
                <li>
                  <Link href="/comercio/login">Ingresar</Link>
                </li>
                <li>
                  <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>
                </li>
              </ul>
            </div>
          </div>

          <div className={estilos.pieBase}>
            <span>
              © {new Date().getFullYear()} {MARCA.nombre}. Tarjetas de lealtad digitales en El
              Salvador.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
