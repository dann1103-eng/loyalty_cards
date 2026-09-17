import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import estilos from './_inicio/inicio.module.css';
import FormularioDemo from './_inicio/FormularioDemo';
import PegatinasParallax from './_inicio/PegatinasParallax';
import MedirVistaPlanes from './_inicio/MedirVistaPlanes';
import EnlaceWhatsApp from './_inicio/EnlaceWhatsApp';
import { STICKERS, type Sticker } from './_inicio/stickers';
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
  IconoInstagram,
  IconoTikTok,
  IconoWhatsApp,
  IconoGarabato,
} from './_inicio/iconos';
import { MARCA } from '@/lib/marca';
import { openGraphDe, twitterDe } from '@/lib/metadatosOg';
import { TIPOS, buscarTipo } from '@/lib/tarjetas/tipos';

// Página de entrada de cardly-sv.site. Le habla a DUEÑOS DE COMERCIO que todavía no son clientes:
// el cliente final nunca llega acá, llega por el código de su propio comercio.
//
// TERCERA pasada del rediseño 2026-07-29, y la primera con el KIT DE MARCA REAL en mano
// (INSUMOS: paleta oficial en PDF, logo editable, la foto del chavo, los tres modelos de tarjeta,
// las tres capturas de Wallet y nueve stickers). Las dos pasadas anteriores dibujaban en CSS lo
// que se veía en una captura del mockup; todo eso se retiró y quedó reemplazado por el archivo
// real, que siempre se ve mejor que su imitación. Lo que se dibuja en CSS es solo lo que NO viene
// en el kit: los íconos de línea de las franjas y el garabato de "Pasate al club".
//
// Ver DESIGN.md § Página pública para la paleta, la tipografía y el detalle de qué se sustituyó a
// propósito respecto del mockup: sin contadores de piloto inventados y sin teléfono ni redes falsas
// en el pie.
//
// Desde el 2026-08-07 los botones principales llevan al ALTA REAL (/registro-comercio) y ya no al
// formulario de interés: el alta self-service existe. #demo se conserva como segunda opción para
// quien prefiere que se la muestren antes de registrarse — sigue escribiendo en `prospectos`.
// Cada plan de la tabla de precios entra al alta con SU plan ya elegido (?plan=<id>).

const TITULO = `${MARCA.nombre} — Tarjetas de lealtad digitales para tu negocio`;
const DESCRIPCION =
  'Sellos, puntos, cashback, gift card y más, directo en la billetera del teléfono de tus clientes. Sin apps que instalar y sin plásticos que perder. Agendá una demo.';

export const metadata: Metadata = {
  // `absolute` para saltarse el template `%s · Cardly SV` del layout: este título ya nombra la
  // marca, y con el template quedaría "Cardly SV — … · Cardly SV".
  title: { absolute: TITULO },
  description: DESCRIPCION,
  alternates: { canonical: '/' },
  // Por los helpers y NO escribiendo `{ url, title, description }` a mano: Next reemplaza el objeto
  // `openGraph` entero en vez de combinarlo con el del layout, así que armarlo a mano acá deja la
  // página sin `og:image`. Ver el encabezado de lib/metadatosOg.ts — ya pasó una vez.
  openGraph: openGraphDe({ titulo: TITULO, descripcion: DESCRIPCION, url: '/' }),
  twitter: twitterDe({ titulo: TITULO, descripcion: DESCRIPCION }),
  // Verificación del dominio en Meta Business. Va en la metadata ESTÁTICA de esta página y no en un
  // script: el rastreador de Meta no ejecuta JavaScript, así que la etiqueta tiene que venir en el
  // <head> del HTML que manda el servidor. Una `metadata` exportada como objeto no se transmite en
  // diferido (eso solo le pasa a `generateMetadata`), así que llega en el <head> para cualquier
  // agente, bot o no. El token es público por diseño: cualquiera lo lee en el código fuente.
  verification: {
    other: { 'facebook-domain-verification': 'sf0fzw67mjy5evifbhrki6fk8b764b' },
  },
};

// Los stickers son decorativos y siempre se pintan igual: un solo componente evita repetir el
// aria-hidden y el alt vacío nueve veces (y que a la décima se olvide uno).
function Pegatina({ sticker, clase }: { sticker: Sticker; clase: string }) {
  return (
    <Image
      className={`${estilos.pegatina} ${clase}`}
      src={sticker.archivo}
      alt=""
      aria-hidden="true"
      width={sticker.ancho}
      height={sticker.alto}
      // Lo que PegatinasParallax busca para darles la deriva por scroll. Un atributo de datos y no
      // la clase del módulo CSS: esa clase lleva un hash que cambia en cada build, así que un
      // querySelector contra ella se rompería solo.
      data-pegatina=""
    />
  );
}

const CONFIANZA = [
  {
    titulo: 'Apple Wallet y Google Wallet',
    texto: 'Sin apps que instalar, sin plásticos que perder.',
    Icono: IconoPersonas,
  },
  {
    titulo: `${TIPOS.length} tipos de tarjeta`,
    texto: 'Sellos, puntos, cashback, gift card y más.',
    Icono: IconoTarjeta,
  },
  {
    titulo: 'Tu marca, no la nuestra',
    texto: 'Tus colores y tu logo en cada pantalla.',
    Icono: IconoRayo,
  },
];

const PASOS = [
  {
    titulo: 'Creás tu tarjeta',
    texto: 'Diseñala a tu estilo. En minutos. 100% digital.',
    imagen: '/_inicio/wallet-puntos.webp',
    // El alt describe QUÉ SE VE, porque estas tres imágenes son el argumento de la sección: quien
    // no las ve necesita saber que la tarjeta se ve así de terminada dentro de Wallet.
    // (Son maquetas del kit, no capturas: ver la nota en .pasoTelefono de inicio.module.css.)
    alt: 'La tarjeta de un negocio dentro de Apple Wallet, con 50 puntos y el código del cliente.',
  },
  {
    titulo: 'El cliente la guarda',
    texto: 'En su Wallet. Sin apps. Sin registros.',
    imagen: '/_inicio/wallet-sellos-futbol.webp',
    alt: 'Una tarjeta de sellos de una cancha de fútbol en Wallet, con siete sellos de nueve marcados.',
  },
  {
    titulo: 'Sumás o canjeás',
    texto: 'Con un escaneo. Así de simple. Así de rápido.',
    imagen: '/_inicio/wallet-sellos-gym.webp',
    alt: 'Una tarjeta de sellos de un gimnasio en Wallet, con dos de ocho sellos y su código.',
  },
];

// Los modelos REALES que se muestran, uno por tipo de tarjeta. Del kit original quedan dos (sellos
// y puntos): se retiró la de "Puntos" violeta con el QR gigante y el logo de Cardly por pedido del
// dueño — es la tarjeta de MUESTRA de Cardly, no la de un comercio, así que en una sección que
// promete "la marca de cada negocio" contaba la historia equivocada. El 2026-09-17 se sumaron
// membresía, gift card y descuento, que ya traen el frente nuevo del pase (nombre y apellido,
// "Powered by Cardly" bajo el QR).
//
// Cada modelo declara su `tipo` y de ahí sale lo demás: el rótulo es la `etiqueta` del catálogo
// (así "Gift card" se escribe igual en la tira, en los chips del cartel y en el panel del dueño), y
// el cartel del final nombra los tipos que NO están en esta lista. Ver TIPOS_SIN_MODELO abajo.
const MODELOS = [
  {
    tipo: 'sellos',
    imagen: '/_inicio/tarjeta-sellos.webp',
    alt: 'Tarjeta de sellos de un gimnasio: fondo negro, promoción de temporada y dos de ocho sellos.',
  },
  {
    tipo: 'puntos',
    imagen: '/_inicio/tarjeta-puntos-bu.webp',
    alt: 'Tarjeta de puntos azul marino con una franja celeste que muestra 50 puntos.',
  },
  {
    tipo: 'membresia',
    imagen: '/_inicio/tarjeta-membresia.webp',
    alt: 'Pase de membresía de un gimnasio: fondo negro, franja de la mensualidad VIP, válido hasta el 16 de octubre de 2026, con el nombre y el apellido del socio.',
  },
  {
    tipo: 'gift_card',
    imagen: '/_inicio/tarjeta-gift-card.webp',
    alt: 'Gift card de un estudio de arte: fondo oscuro, franja con un moño plateado y un saldo de $50.',
  },
  {
    tipo: 'descuento',
    imagen: '/_inicio/tarjeta-descuento.webp',
    alt: 'Tarjeta de descuento de una joyería: fondo café, franja con unos aretes dorados y 40% de descuento.',
  },
].map((modelo) => {
  // Un `tipo` mal escrito REVIENTA al armar la página (se prerenderiza en el build) en vez de
  // publicar una tarjeta sin rótulo — que además seguiría apareciendo en el cartel de los que
  // faltan, porque TIPOS_SIN_MODELO no la reconocería como suya.
  const tipo = buscarTipo(modelo.tipo);
  if (!tipo) throw new Error(`La portada muestra un modelo de un tipo que no existe: ${modelo.tipo}`);
  return { ...modelo, nombre: tipo.etiqueta };
});

// Los tipos que no tienen modelo todavía, para el cartel del final de la tira. Se derivan del
// catálogo y de MODELOS en vez de escribirse a mano: un tipo nuevo en lib/tarjetas/tipos.ts
// aparece acá solo, y un modelo nuevo arriba sale de acá solo. Antes esto excluía `sellos` y
// `puntos` a mano, así que sumar un modelo obligaba a acordarse de tocar también esta línea — y
// si no, ese tipo salía dos veces: con su tarjeta y en el cartel.
const TIPOS_SIN_MODELO = TIPOS.filter((t) => !MODELOS.some((m) => m.tipo === t.valor));

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

// Precios y límites REALES, no los del texto de marketing: el monto sale de `PLANES` en
// lib/comercios/cuentas.ts, que es la fuente única del monto y el límite sugerido de negocios y
// sucursales de cada plan.
//
// El límite del plan NO es "negocios": cuenta **comercios distintos + sucursales adicionales,
// sumados**, y la sucursal principal de cada comercio no consume cupo (ver contarUnidadesCuenta).
//
// ══ ESCALERA 1 / 3 / 10 (2026-08-13) ══ Antes era 1 / 2 / sin límite. Se alineó a la escalera que
// usan TODOS los competidores (Vuelvo Cards, Loyalty Ladder, Cardly MX, Loopy Loyalty): el comprador
// ya la vio en dos o tres cotizaciones antes de llegar acá, así que un escalón distinto se lee como
// "menos" aunque el precio sea mejor. Y el tope de Pro en 10 no es arbitrario: es el techo TÉCNICO
// del geopush (Apple admite 10 ubicaciones por pase e ignora la 11 en silencio; Google rechaza la
// clase entera con más de 10), así que arriba de 10 locales el aviso por cercanía no los cubriría a
// todos igual. Arriba de ese tope se sube `limite_negocios` a mano desde el panel FM cobrando el
// adicional por local.
//
// "Hasta 2 tarjetas activas" es real y es igual en los tres planes (spec de programas de tarjeta):
// es la cantidad de programas simultáneos por comercio, cada uno con su propio QR.
//
// ══ CLIENTES: SIN LÍMITE EN LOS TRES PLANES ══ Corrección directa del dueño (2026-07-29): el
// catálogo comercial traía 500/2.500/sin límite, y esa cifra ya no rige — ningún plan topea
// clientes. `verificarLimiteCuenta` (lib/comercios/cuentas.ts) tampoco los cuenta: solo mira
// comercios y sucursales, así que el código y este texto quedan alineados sin tocar nada más.
//
// ══ CONTROL DE CAJEROS: EN LOS TRES PLANES ══ Corrección del dueño, misma fecha: la auditoría de
// cada sello (Tanda 1, antifraude) es pareja en todos los planes, no un extra de Pro.
//
// Avisos por cercanía (geopush): arranca en Growth, así que Starter no lo lista y Pro lo hereda.
const PLANES_PRECIO: PlanPrecio[] = [
  {
    id: 'starter',
    nombre: 'Starter',
    precio: 29,
    caracteristicas: [
      '1 negocio con su local',
      'Hasta 2 tarjetas activas, cada una con su QR',
      'Clientes ilimitados',
      'Control de cajeros y auditoría de cada sello',
      'Soporte por WhatsApp',
    ],
    cta: 'Empezar',
  },
  {
    id: 'growth',
    nombre: 'Growth',
    precio: 49,
    destacado: true,
    etiqueta: 'Más elegido',
    caracteristicas: [
      'Avisos por cercanía: tus clientes se enteran al pasar por el local',
      'Hasta 3 negocios o sucursales',
      'Hasta 2 tarjetas activas por negocio',
      'Clientes ilimitados',
      'Control de cajeros, auditoría y reportes por sucursal',
    ],
    cta: 'Empezar',
  },
  {
    id: 'pro',
    nombre: 'Pro',
    precio: 89,
    caracteristicas: [
      'Hasta 10 negocios o sucursales',
      'Hasta 2 tarjetas activas por negocio',
      'Clientes ilimitados',
      'Control de cajeros, auditoría y avisos por cercanía',
      'Soporte prioritario',
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
    respuesta: 'Cuando quieras, desde tu panel. Pedís el cambio y lo aplicamos sin que pierdas ni un cliente ni un saldo.',
  },
  {
    pregunta: '¿Qué pasa si quiero cancelar?',
    respuesta: 'Cancelás cuando quieras, sin permanencia ni penalidad.',
  },
  {
    pregunta: '¿Puedo probar antes de pagar?',
    respuesta: 'Sí. Agendá una demo y te mostramos tu tarjeta funcionando con tus colores, antes de que pagues nada.',
  },
  {
    pregunta: '¿Puedo tener más de una tarjeta en mi negocio?',
    respuesta: 'Sí: hasta dos activas a la vez, cada una con su propio código. Sirve para tener la de siempre y una de campaña, y podés apagar la de campaña cuando termine.',
  },
];

export default function Inicio() {
  return (
    <div className={estilos.pagina}>
      {/* Solo cablea el parallax sobre los stickers que ya vienen en el HTML del servidor; no
          dibuja nada. Ver el encabezado de PegatinasParallax.tsx para por qué el efecto va en JS y
          no con animaciones de scroll de CSS. */}
      <PegatinasParallax />

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
            {/* En INGLÉS a propósito, igual que el logo: "You in?" es la firma de la marca, no una
                frase traducible. El resto del copy sigue en español con voseo. */}
            <Link className={estilos.botonCabecera} href="/registro-comercio">
              You in?
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className={estilos.hero}>
          {/* La foto va PRIMERO en el DOM y de fondo a sangre; el texto se superpone encima, a la
              izquierda. `priority` porque es la imagen más grande del primer pliegue: sin eso Next
              la carga en diferido y el hero arranca en negro. */}
          {/* `unoptimized` a propósito, y es el único <Image> de la página que lo lleva por este
              motivo: el archivo YA es el máximo que existe (688×888, el original del kit) y ya está
              en WebP a calidad 94. Con el optimizador activo Next elegía del srcset una variante de
              458px para un hero de 1265 de ancho — o sea que ESTIRABA 2,76× una imagen que él mismo
              había encogido primero. Sirviendo el archivo tal cual, el estiramiento baja a 1,84×.
              Cuando llegue un export más grande del original, esto puede volver a `optimized`. */}
          <Image
            className={estilos.heroFoto}
            src="/_inicio/hero-chico.webp"
            alt="Un cliente muestra en su teléfono la tarjeta de lealtad de un negocio, con su código listo para que se lo escaneen."
            width={688}
            height={888}
            priority
            unoptimized
            sizes="100vw"
          />
          <span className={estilos.heroVelo} aria-hidden="true" />

          <div className={`${estilos.envoltura} ${estilos.heroRejilla}`}>
            <div className={estilos.heroTexto}>
              <h1 className={estilos.heroTitulo}>
                Tu club.
                <br />
                Tus reglas.
              </h1>
              <p className={estilos.heroFirma}>You in?</p>
              <p className={estilos.heroLinea}>
                Sellos, puntos, cashback o lo que decidas: tus clientes lo llevan en la billetera
                del teléfono, y vos ponés el límite de cuánto dar y a quién.
              </p>
              <Link className={estilos.botonHero} href="/registro-comercio">
                Creá tu cuenta
              </Link>
              <p className={estilos.heroNota}>
                Sin tarjeta de crédito y sin instalar nada. ¿Preferís que te la mostremos primero?{' '}
                <a href="#demo">Agendá tu demo</a>.
              </p>
            </div>
          </div>

          <Pegatina sticker={STICKERS.yeah} clase={estilos.stickerHeroUno} />
          <Pegatina sticker={STICKERS.tasteThis} clase={estilos.stickerHeroDos} />
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

        <section id="como-funciona" className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Así
              <span className={estilos.script}>funciona</span>
            </h2>
            <ol className={estilos.pasos} role="list">
              {PASOS.map((paso, indice) => (
                <li key={paso.titulo} className={estilos.paso}>
                  <span className={estilos.pasoNumero} aria-hidden="true">{indice + 1}</span>
                  <h3>{paso.titulo}</h3>
                  <p>{paso.texto}</p>
                  <div className={estilos.pasoTelefono}>
                    <Image
                      src={paso.imagen}
                      alt={paso.alt}
                      width={695}
                      height={1090}
                      sizes="230px"
                    />
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <Pegatina sticker={STICKERS.futuro} clase={estilos.stickerPasosUno} />
        </section>

        <section id="tarjetas" className={`${estilos.seccion} ${estilos.bandaClara}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Tarjetas
              <span className={estilos.script}>para cada negocio</span>
            </h2>
            <p className={estilos.textoSeccion}>
              Elegís el logo y los colores; nosotros armamos la tarjeta dentro de la billetera.
            </p>

            {/* tabIndex hace la tira recorrible con las flechas del teclado: Chrome y Safari no
                hacen enfocable un contenedor con scroll si no tiene nada enfocable adentro, y acá
                adentro solo hay imágenes y texto. Un elemento enfocable necesita nombre, de ahí el
                aria-label. NO lleva aria-roledescription="carrusel" a propósito: eso anuncia
                controles de carrusel que esta tira no tiene. */}
            <div
              className={estilos.modelosTira}
              tabIndex={0}
              role="group"
              aria-label="Modelos de tarjeta"
            >
              <div className={estilos.modelosFila}>
                {MODELOS.map((modelo) => (
                  <div key={modelo.tipo} className={estilos.modelo}>
                    <Image
                      className={estilos.modeloImagen}
                      src={modelo.imagen}
                      alt={modelo.alt}
                      width={695}
                      height={1090}
                      sizes="(max-width: 639px) 62vw, 340px"
                    />
                    <span className={estilos.modeloNombre}>{modelo.nombre}</span>
                  </div>
                ))}

                {/* El cierre de la tira: cuántos tipos más hay y cuáles son. No es una tarjeta
                    maquetada por nosotros — es un cartel con la silueta de una tarjeta. */}
                <div className={estilos.modelo}>
                  <div className={estilos.modeloMas}>
                    <span className={estilos.modeloMasCuenta} aria-hidden="true">
                      +{TIPOS_SIN_MODELO.length}
                    </span>
                    <span className={estilos.modeloMasTitulo}>
                      {TIPOS_SIN_MODELO.length} tipos más, para el negocio que tengas
                    </span>
                    <ul className={estilos.tiposLista} role="list">
                      {TIPOS_SIN_MODELO.map((tipo) => (
                        <li key={tipo.valor} className={estilos.tipoChip}>
                          {tipo.etiqueta}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <span className={estilos.modeloNombre}>Y más</span>
                </div>
              </div>
            </div>

            {/* Aclaración honesta: Apple y Google pintan el fondo de la tarjeta con UN color sólido
                (backgroundColor / hexBackgroundColor), no con la textura de estas ilustraciones. Lo
                que sí es fiel es la franja del medio (el logo, el saldo, el QR) — ver el comentario
                de .pasoTelefono en el CSS para el detalle técnico. */}
            <p className={estilos.modelosNota}>
              Estas ilustraciones muestran el diseño completo a modo de referencia. En Apple y
              Google Wallet, el fondo de tu tarjeta es un color sólido a tu elección; el logo, el
              saldo y el código sí se ven exactamente así.
            </p>
          </div>

          <Pegatina sticker={STICKERS.iconic} clase={estilos.stickerTarjetasUno} />
          <Pegatina sticker={STICKERS.pasaElBalon} clase={estilos.stickerTarjetasDos} />
        </section>

        <section className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              ¿Seguís usando
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

          <Pegatina sticker={STICKERS.evolucion} clase={estilos.stickerDoloresUno} />
        </section>

        <section id="precios" className={`${estilos.seccion} ${estilos.bandaClara}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Planes
              <span className={estilos.script}>para crecer</span>
            </h2>
            <p className={estilos.textoSeccion}>
              El plan se mide en negocios y sucursales. Tu primer local no consume cupo, y cambiás
              de plan cuando quieras.
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
                  <Link
                    className={plan.destacado ? estilos.botonHero : estilos.botonHeroContorno}
                    href={`/registro-comercio?plan=${plan.id}`}
                  >
                    {plan.cta}
                    <IconoFlecha style={{ width: 16, height: 16, marginLeft: 6 }} />
                  </Link>
                </div>
              ))}
            </div>
            <p className={estilos.planNota}>
              Todos los planes se configuran solos: la plataforma es autoservicio y trae un tutorial
              paso a paso, así que no pagás nada por arrancar. Si tu empresa prefiere que
              capacitemos a su personal, el <strong>onboarding es opcional</strong>: $150 de pago
              único, el mismo precio en los tres planes.
            </p>
          </div>

          <Pegatina sticker={STICKERS.woah} clase={estilos.stickerPlanesUno} />
          <MedirVistaPlanes idSeccion="precios" />
        </section>

        <section id="preguntas" className={`${estilos.seccion} ${estilos.bandaOscura}`}>
          <div className={estilos.envoltura}>
            <h2 className={estilos.tituloSeccion}>
              Preguntas
              <span className={estilos.script}>frecuentes</span>
            </h2>
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

          <Pegatina sticker={STICKERS.hechaParaGanar} clase={estilos.stickerPreguntasUno} />
        </section>

        <section id="demo" className={`${estilos.seccion} ${estilos.cierre}`}>
          <div className={estilos.envoltura}>
            <div className={estilos.cierreCabecera}>
              <h2 className={estilos.cierreTitulo}>
                You <em>in?</em>
              </h2>
              <p className={estilos.heroLinea}>
                Contanos de tu negocio y te escribimos para mostrarte cómo se vería tu tarjeta
                funcionando de verdad.
              </p>
            </div>

            <div className={estilos.cierreGrilla}>
              <div>
                <ul className={estilos.cierreLista} role="list">
                  <li>Te respondemos en menos de un día hábil.</li>
                  <li>Te enseñamos tu tarjeta con tus colores y tu logo.</li>
                  <li>Vemos juntos qué tipo de tarjeta te conviene.</li>
                  <li>
                    ¿Preferís escribir vos?{' '}
                    <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>
                    <EnlaceWhatsApp prefijo=" o por ">WhatsApp</EnlaceWhatsApp>
                  </li>
                </ul>
                <Image
                  className={estilos.cierreGrupo}
                  src="/_inicio/grupo.webp"
                  alt="Cuatro clientes muestran en sus teléfonos las tarjetas de lealtad de distintos negocios."
                  width={1090}
                  height={695}
                  sizes="(max-width: 859px) 100vw, 45vw"
                />
              </div>
              <FormularioDemo />
            </div>
          </div>

          <Pegatina sticker={STICKERS.bienvenido} clase={estilos.stickerCierreUno} />
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
            <span className={estilos.pieRedes}>
              {/* Instagram y TikTok siguen decorativos, sin <a>: todavía no hay cuentas sociales
                  reales de Cardly SV para enlazar (ver el comentario de .pieRedes en el CSS). */}
              <span className={estilos.pieRedes} aria-hidden="true">
                <IconoInstagram />
                <IconoTikTok />
              </span>
              {/* WhatsApp es enlace de verdad SOLO si está NEXT_PUBLIC_WHATSAPP_CARDLY (y mide
                  Contact de Meta); sin el número queda decorativo, como los otros dos. */}
              <EnlaceWhatsApp
                etiqueta="Escribinos por WhatsApp"
                alternativa={
                  <span className={estilos.pieRedes} aria-hidden="true">
                    <IconoWhatsApp />
                  </span>
                }
              >
                <IconoWhatsApp />
              </EnlaceWhatsApp>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
