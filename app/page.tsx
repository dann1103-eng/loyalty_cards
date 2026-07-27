import type { Metadata } from 'next';
import Link from 'next/link';
import estilos from './_inicio/inicio.module.css';
import CarruselTarjetas from './_inicio/CarruselTarjetas';
import FormularioDemo from './_inicio/FormularioDemo';
import { MARCA } from '@/lib/marca';

// Página de entrada de cardly-sv.site. Le habla a DUEÑOS DE COMERCIO que todavía no son clientes:
// el cliente final nunca llega acá, llega por el código de su propio comercio. Por eso no hay
// contadores ("8 comercios ya usan…"): son números de piloto y restan. Lo que convence es ver el
// producto en movimiento.

export const metadata: Metadata = {
  title: `${MARCA.nombre} — Tarjetas de lealtad digitales para tu negocio`,
  description:
    'Tus clientes suman sellos o puntos en cada visita y llevan la tarjeta de tu negocio en la billetera de su teléfono. Sin app que instalar y sin plásticos. Agendá una demo.',
};

const PASOS = [
  {
    titulo: 'Armás tu tarjeta',
    texto:
      'Elegís los colores de tu marca, subís tu logo y decidís si premiás con sellos o con puntos. Se hace en minutos y no necesitás diseñador.',
  },
  {
    titulo: 'Tu cliente la guarda',
    texto:
      'Escanea el código que ponés en el mostrador, deja su nombre y su teléfono, y la tarjeta le queda en la billetera del teléfono. No instala nada.',
  },
  {
    titulo: 'Sumás en cada visita',
    texto:
      'Tu cajero escanea la tarjeta desde su propio acceso y el saldo se actualiza al instante, en el bolsillo del cliente.',
  },
];

const BENEFICIOS = [
  {
    titulo: 'Vuelven más seguido',
    texto:
      'La tarjeta vive junto a la tarjeta de crédito y el pase de abordar. No se queda en una gaveta ni se pierde entre los recibos.',
  },
  {
    titulo: 'Se actualiza sola',
    texto:
      'Cuando el cliente suma puntos o cambiás una promoción, la tarjeta se refresca en su teléfono sin que él tenga que hacer nada.',
  },
  {
    titulo: 'Dejás de adivinar',
    texto:
      'Un panel con visitas, clientes nuevos y premios canjeados, por sucursal y por período. Vas a saber qué promoción sirvió.',
  },
  {
    titulo: 'Varias sucursales, un solo programa',
    texto:
      'Cada sucursal con su propio cajero y su propio corte, todas bajo la misma tarjeta y el mismo saldo del cliente.',
  },
  {
    titulo: 'Cero fricción para el cliente',
    texto:
      'Nada que descargar, nada que recordar, ninguna contraseña. La billetera ya viene instalada en su teléfono.',
  },
  {
    titulo: 'El diseño es tuyo',
    texto:
      'Tus colores y tu logo en la pantalla del cliente cada vez que abre la billetera. No es nuestra marca la que se luce.',
  },
];

export default function Inicio() {
  return (
    <div className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <span className={estilos.marca}>
          <span className={estilos.marcaPunto} aria-hidden="true">
            C
          </span>
          {MARCA.nombre}
        </span>
        <nav className={estilos.navCabecera}>
          <Link className={estilos.enlaceCabecera} href="/mi-tarjeta">
            Buscá tu tarjeta
          </Link>
          <Link className={estilos.enlaceCabecera} href="/comercio/login">
            Ingresar
          </Link>
          <a className={estilos.botonCabecera} href="#demo">
            Agendá tu demo
          </a>
        </nav>
      </header>

      <main>
        <section className={`${estilos.hero} ${estilos.envoltura}`}>
          <p className={estilos.kicker}>Tarjetas de lealtad digitales · El Salvador</p>
          <h1 className={estilos.heroTitulo}>
            Tu tarjeta de lealtad, <em>en el teléfono</em> de tus clientes
          </h1>
          <p className={estilos.heroTexto}>
            Tus clientes suman sellos o puntos en cada visita y llevan la tarjeta de tu negocio en
            Apple Wallet o Google Wallet. Sin app que instalar, sin plásticos que se pierden, sin
            imprimir nada.
          </p>
          <div className={estilos.heroAcciones}>
            <a className={estilos.botonPrimario} href="#demo">
              Agendá tu demo
            </a>
            <a className={estilos.botonSecundario} href="#tarjetas">
              Mirá cómo se ve
            </a>
          </div>
        </section>

        {/* El carrusel va a lo ancho de la pantalla, fuera de la envoltura: el abanico tiene que
            desbordar los costados, no acomodarse dentro de una columna. */}
        <section id="tarjetas" className={estilos.seccion}>
          <div className={`${estilos.envoltura} ${estilos.centrado}`}>
            <h2 className={estilos.tituloSeccion}>Así se le ve a tu cliente</h2>
            <p className={estilos.textoSeccion}>
              Vos elegís los colores, el logo y si premiás con sellos o con puntos. Estos son
              diseños de muestra que armamos nosotros: negocios de ejemplo, no clientes reales.
            </p>
          </div>
          <CarruselTarjetas />
        </section>

        <section id="como-funciona" className={`${estilos.seccion} ${estilos.envoltura}`}>
          <div className={estilos.centrado}>
            <h2 className={estilos.tituloSeccion}>Cómo funciona</h2>
            <p className={estilos.textoSeccion}>Tres pasos, y el más largo lo hacés una sola vez.</p>
          </div>
          <div className={estilos.pasos}>
            {PASOS.map((paso, indice) => (
              <article key={paso.titulo} className={estilos.paso}>
                <span className={estilos.pasoNumero} aria-hidden="true">
                  {indice + 1}
                </span>
                <h3>{paso.titulo}</h3>
                <p>{paso.texto}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={`${estilos.seccion} ${estilos.envoltura}`}>
          <div className={estilos.centrado}>
            <h2 className={estilos.tituloSeccion}>Qué gana tu negocio</h2>
            <p className={estilos.textoSeccion}>
              Un programa de lealtad sirve cuando el cliente lo lleva encima. Ahí es justo donde
              vive esta tarjeta.
            </p>
          </div>
          <div className={estilos.beneficios}>
            {BENEFICIOS.map((beneficio) => (
              <article key={beneficio.titulo} className={estilos.beneficio}>
                <h3>{beneficio.titulo}</h3>
                <p>{beneficio.texto}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="demo" className={`${estilos.seccion} ${estilos.envoltura}`}>
          <div className={estilos.demo}>
            <div>
              <h2 className={estilos.tituloSeccion}>Agendá tu demo</h2>
              <p className={estilos.textoSeccion}>
                Contanos de tu negocio y te escribimos para mostrarte cómo se vería tu tarjeta
                funcionando de verdad. Sin compromiso.
              </p>
              <ul className={estilos.lista}>
                <li>Te respondemos en menos de un día hábil.</li>
                <li>Te enseñamos tu tarjeta con tus colores y tu logo.</li>
                <li>Vemos juntos si te conviene premiar con sellos o con puntos.</li>
                <li>
                  ¿Preferís escribir vos?{' '}
                  <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>
                </li>
              </ul>
            </div>
            <FormularioDemo />
          </div>
        </section>
      </main>

      <footer className={estilos.pie}>
        <div className={`${estilos.envoltura} ${estilos.pieFilas}`}>
          <span>{MARCA.nombre} — Tarjetas de lealtad digitales en El Salvador</span>
          <nav className={estilos.pieEnlaces}>
            <a href={`mailto:${MARCA.correoSoporte}`}>{MARCA.correoSoporte}</a>
            <Link href="/mi-tarjeta">Buscá tu tarjeta</Link>
            <Link href="/comercio/login">Ingresar</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
