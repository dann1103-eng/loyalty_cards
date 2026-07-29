import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import estilos from './_inicio/inicio.module.css';
import CarruselTarjetas from './_inicio/CarruselTarjetas';
import FormularioDemo from './_inicio/FormularioDemo';
import {
  IconoPersonas,
  IconoTarjeta,
  IconoRayo,
  IconoSello,
  IconoLibreta,
  IconoCalculadora,
  IconoChat,
  IconoPin,
  IconoX,
  IconoFlecha,
  IconoCheck,
  IconoInstagram,
  IconoTikTok,
  IconoWhatsApp,
  IconoGarabato,
} from './_inicio/iconos';
import { MARCA } from '@/lib/marca';
import { TIPOS } from '@/lib/tarjetas/tipos';

// Página de entrada de cardly-sv.site. Le habla a DUEÑOS DE COMERCIO que todavía no son clientes:
// el cliente final nunca llega acá, llega por el código de su propio comercio.
//
// Rediseño 2026-07-29 a partir de un mockup que trajo el dueño, en DOS pasadas: la primera trajo
// la paleta (noche + lima + violeta) pero seguía siendo "inspirado en", no una réplica; el dueño
// pidió explícitamente calcar la estructura de cada sección y recién después iterar. Esta segunda
// pasada es esa réplica: la franja de confianza con íconos, "Así funciona" con capturas reales de
// teléfono, la grilla de mini-tarjetas por tipo, "¿Seguís usando esto?" con íconos + insignia
// violeta, las tarifas en tarjetas blancas con Growth invertida, las preguntas en grilla de dos
// columnas y el cierre en violeta sólido con el pie de tres columnas. Ver DESIGN.md § Página
// pública para el detalle de qué se copió tal cual y qué se sustituyó a propósito (sin contadores
// de piloto inventados, sin teléfono ni correo falsos, sin un botón que prometa alta instantánea:
// todo apunta al formulario real de #demo).

export const metadata: Metadata = {
  title: `${MARCA.nombre} — Tarjetas de lealtad digitales para tu negocio`,
  description:
    'Sellos, puntos, cashback, gift card y más, directo en la billetera del teléfono de tus clientes. Sin apps que instalar y sin plásticos que perder. Agendá una demo.',
};

const CONFIANZA = [
  {
    titulo: 'Apple Wallet y Google Wallet',
    texto: 'Sin apps que instalar, sin plásticos que perder.',
    Icono: IconoPersonas,
  },
  {
    titulo: `${TIPOS.length} tipos de tarjeta`,
    texto: TIPOS.map((tipo) => tipo.etiqueta).join(', ') + '.',
    Icono: IconoTarjeta,
  },
  {
    titulo: 'Tu marca, no la nuestra',
    texto: 'Tus colores y tu logo en cada pantalla.',
    Icono: IconoRayo,
  },
];

// Un color y un valor de ejemplo por tipo, solo para ilustrar la mini-tarjeta: no es dato de
// negocio (por eso vive acá y no en lib/tarjetas/tipos.ts), es la misma idea que MODELOS en
// modelos.ts para el carrusel del hero — negocios y cifras de mentira, variedad real de tipos.
const COLOR_TIPO: Record<string, string> = {
  puntos: '#3f5fb8',
  sellos: '#2a2f26',
  prepago: '#1f6f6b',
  gift_card: '#1f5f66',
  cashback: '#2f7d3a',
  cupon: '#6a3fa0',
  membresia: '#7a1f3d',
  descuento: '#a8790f',
};
const VALOR_TIPO: Record<string, string> = {
  puntos: '120',
  sellos: '8/10',
  prepago: '$150',
  gift_card: '$250',
  cashback: '5%',
  cupon: '2X1',
  membresia: 'VIP',
  descuento: '-15%',
};

const PASOS = [
  {
    titulo: 'Creás tu tarjeta',
    texto: 'Diséñala a tu estilo. En minutos. 100% digital.',
    pantalla: 'crear' as const,
  },
  {
    titulo: 'El cliente la guarda',
    texto: 'En su Wallet. Sin apps. Sin registros.',
    pantalla: 'escanear' as const,
  },
  {
    titulo: 'Sumás o canjeás',
    texto: 'Con un escaneo. Así de simple. Así de rápido.',
    pantalla: 'exito' as const,
  },
];

function PantallaPaso({ tipo }: { tipo: 'crear' | 'escanear' | 'exito' }) {
  if (tipo === 'crear') {
    return (
      <div className={estilos.pantallaCrear}>
        <span className={estilos.pantallaCrearLogo}>CARDLY</span>
        <div className={estilos.pantallaCrearTarjeta} />
        <div className={estilos.pantallaCrearColores} aria-hidden="true">
          <span style={{ background: '#101014' }} />
          <span style={{ background: '#8b5e3c' }} />
          <span style={{ background: '#c0472e' }} />
          <span style={{ background: '#3f7d3a' }} />
        </div>
      </div>
    );
  }
  if (tipo === 'escanear') {
    return (
      <div className={estilos.pantallaEscanear}>
        <div className={estilos.pantallaEscanearTarjeta} />
        <span className={estilos.pantallaEscanearNombre}>Daniel</span>
        <div className={estilos.pantallaEscanearQr}>
          <svg viewBox="0 0 9 9" aria-hidden="true">
            {Array.from({ length: 9 }, (_, fila) =>
              Array.from({ length: 9 }, (_, col) =>
                (fila + col * 2) % 3 === 0 ? (
                  <rect key={`${fila}-${col}`} x={col} y={fila} width="1" height="1" fill="currentColor" />
                ) : null,
              ),
            )}
          </svg>
        </div>
      </div>
    );
  }
  return (
    <div className={estilos.pantallaExito}>
      <IconoCheck className={estilos.pantallaExitoCheck} />
      <span className={estilos.pantallaExitoTexto}>¡Listo!</span>
      <span className={estilos.pantallaExitoPill}>+10 puntos</span>
    </div>
  );
}

const DOLORES = [
  {
    titulo: 'Sellos falsificados',
    texto: 'Cualquiera con un sello de goma te vacía el programa.',
    Icono: IconoSello,
  },
  {
    titulo: 'Sin control',
    texto: 'No sabés quién dio de más, ni cuándo ni cuánto.',
    Icono: IconoLibreta,
  },
  {
    titulo: 'Excel',
    texto: 'Caos, errores y sin datos reales.',
    Icono: IconoCalculadora,
  },
  {
    titulo: 'WhatsApp',
    texto: 'Mensajes perdidos, clientes cansados.',
    Icono: IconoChat,
  },
  {
    titulo: 'Sin geo',
    texto: 'No sabés cuándo tu cliente está cerca.',
    Icono: IconoPin,
  },
  {
    titulo: 'Sin tu base',
    texto: 'Tu cliente no es tuyo. Es de la app.',
    Icono: IconoPersonas,
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
    cta: 'Empezar',
  },
  {
    id: 'growth',
    nombre: 'Growth',
    precio: 49,
    destacado: true,
    etiqueta: 'Más elegido',
    caracteristicas: [
      'Hasta 2 negocios o sucursales',
      'Hasta 2,500 clientes',
      'Promos push ilimitadas',
      'Reportes mensuales',
    ],
    cta: 'Empezar',
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

              <span className={`${estilos.pegatina} ${estilos.pegatinaHero} ${estilos.pegatinaUno} ${estilos.pegatinaCoral}`} aria-hidden="true">
                100% digital
              </span>
              <span className={`${estilos.pegatina} ${estilos.pegatinaHero} ${estilos.pegatinaDos} ${estilos.pegatinaVioleta}`} aria-hidden="true">
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
                <item.Icono className={estilos.confianzaIcono} />
                <div>
                  <b>{item.titulo}</b>
                  <span>{item.texto}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          id="como-funciona"
          className={`${estilos.seccion} ${estilos.bandaOscura}`}
        >
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Así
              <br />
              <span className={estilos.script}>funciona</span>
            </h2>
            <ol className={estilos.pasos} role="list">
              {PASOS.map((paso, indice) => (
                <li key={paso.titulo} className={estilos.paso}>
                  <span className={estilos.pasoNumero} aria-hidden="true">{indice + 1}</span>
                  <h3>{paso.titulo}</h3>
                  <p>{paso.texto}</p>
                  <div className={estilos.pasoTelefono} aria-hidden="true">
                    <div className={estilos.telefono}>
                      <span className={estilos.isla} />
                      <div className={estilos.pantalla}>
                        <PantallaPaso tipo={paso.pantalla} />
                        <span className={estilos.barraInicio} />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="tarjetas" className={`${estilos.seccion} ${estilos.bandaClara}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Tarjetas
              <br />
              <span className={estilos.script}>para cada negocio</span>
            </h2>
            <div className={estilos.tiposGrilla}>
              {TIPOS.map((tipo) => (
                <div key={tipo.valor} className={estilos.tipoFicha}>
                  <div className={estilos.miniTarjeta} style={{ background: COLOR_TIPO[tipo.valor] }}>
                    <div className={estilos.miniTarjetaCabecera}>
                      <span className={estilos.miniTarjetaLogo}>
                        <Image src="/marca/icono.svg" alt="" width={12} height={12} unoptimized />
                      </span>
                    </div>
                    <span className={estilos.miniTarjetaValor}>{VALOR_TIPO[tipo.valor]}</span>
                    <div className={estilos.miniTarjetaPie}>
                      <span className={estilos.miniTarjetaMiembro}>Daniel</span>
                      <div className={estilos.miniTarjetaQr}>
                        <svg viewBox="0 0 9 9" aria-hidden="true">
                          {Array.from({ length: 9 }, (_, fila) =>
                            Array.from({ length: 9 }, (_, col) =>
                              (fila * 3 + col) % 4 === 0 ? (
                                <rect key={`${fila}-${col}`} x={col} y={fila} width="1" height="1" fill="currentColor" />
                              ) : null,
                            ),
                          )}
                        </svg>
                      </div>
                    </div>
                  </div>
                  <span className={estilos.tipoNombre}>{tipo.etiqueta}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              ¿Seguís
              <br />
              usando
              <br />
              <span className={estilos.script}>esto?</span>
            </h2>
            <ul className={estilos.dolores} role="list">
              {DOLORES.map((dolor) => (
                <li key={dolor.titulo} className={estilos.dolor}>
                  <span className={estilos.dolorIconoEnvoltura} aria-hidden="true">
                    <dolor.Icono className={estilos.dolorIcono} />
                    <span className={estilos.dolorBadge}>
                      <IconoX />
                    </span>
                  </span>
                  <h3>{dolor.titulo}</h3>
                  <p>{dolor.texto}</p>
                </li>
              ))}
            </ul>
            <p className={estilos.doloresPie} aria-hidden="true">
              <IconoGarabato />
              Pasate al club.
              <IconoGarabato style={{ transform: 'scaleX(-1)' }} />
            </p>
          </div>
        </section>

        <section id="precios" className={`${estilos.seccion} ${estilos.bandaClara}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Planes
              <br />
              <span className={estilos.script}>para crecer</span>
            </h2>
            <div className={estilos.planesEnvoltura}>
              <div>
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
                        <IconoFlecha style={{ width: 16, height: 16, marginLeft: 6 }} />
                      </a>
                    </div>
                  ))}
                </div>
                <p className={estilos.planNota}>
                  + instalación inicial de $149 (pago único, todos los planes).
                </p>
              </div>
              <div className={estilos.planesPegatinas} aria-hidden="true">
                <span className={`${estilos.pegatina} ${estilos.pegatinaCeleste}`} style={{ transform: 'rotate(-6deg)' }}>
                  WOAH
                </span>
                <span className={estilos.pegatinaSello}>Vos in</span>
                <span className={`${estilos.pegatina} ${estilos.pegatinaCoral}`} style={{ transform: 'rotate(5deg)' }}>
                  Taste This
                </span>
              </div>
            </div>
          </div>
        </section>

        <section id="preguntas" className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Preguntas
              <br />
              <span className={estilos.script}>frecuentes</span>
            </h2>
            <div className={estilos.preguntasEnvoltura}>
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
              <span
                className={`${estilos.pegatina} ${estilos.pegatinaRosa} ${estilos.preguntasPegatina}`}
                aria-hidden="true"
              >
                Hecha para ganar
              </span>
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
              <div className={estilos.pieMarcaContacto}>
                <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>
                {/* Sin teléfono: el mockup traía uno argentino, que no es de Cardly SV, y no hay
                    uno real todavía para publicar acá. */}
              </div>
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
              </ul>
            </div>

            <div className={estilos.pieColumna}>
              <h3>Recursos</h3>
              <ul>
                <li>
                  <a href="#preguntas">Preguntas</a>
                </li>
                <li>
                  <a href={`mailto:${MARCA.correoSoporte}`}>Soporte</a>
                </li>
              </ul>
            </div>

            <div className={estilos.pieColumna}>
              <h3>Cuenta</h3>
              <ul>
                <li>
                  <Link href="/mi-tarjeta">Buscá tu tarjeta</Link>
                </li>
                <li>
                  <Link href="/comercio/login">Ingresar</Link>
                </li>
              </ul>
            </div>
          </div>

          <div className={estilos.pieBase}>
            <span>
              © {new Date().getFullYear()} {MARCA.nombre}. Tarjetas de lealtad digitales en El
              Salvador.
            </span>
            {/* Íconos decorativos, sin <a>: todavía no hay cuentas sociales reales de Cardly SV
                para enlazar (ver el comentario de .pieRedes en el CSS). */}
            <span className={estilos.pieRedes} aria-hidden="true">
              <IconoInstagram />
              <IconoTikTok />
              <IconoWhatsApp />
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
