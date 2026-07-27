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
//
// El abanico de tarjetas vive DENTRO del hero, a la par del texto, no en una sección aparte más
// abajo: la primera pantalla tiene que mostrar el producto, no prometerlo. Eso se llevó puesto al
// botón "Mirá cómo se ve" (no se manda a ver lo que ya se está viendo) y a la pastilla de kicker
// que repetía la categoría que el título ya dice.

export const metadata: Metadata = {
  title: `${MARCA.nombre} — Tarjetas de lealtad digitales para tu negocio`,
  description:
    'Tus clientes suman sellos o puntos en cada visita y llevan la tarjeta de tu negocio en la billetera de su teléfono. Sin app que instalar y sin plásticos. Agendá una demo.',
};

const PASOS = [
  {
    titulo: 'Armás tu tarjeta',
    texto:
      'Elegís tus colores, subís tu logo y decidís si premiás con sellos o con puntos. En minutos y sin diseñador.',
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

const RAZONES = [
  {
    titulo: 'Vuelven más seguido',
    texto:
      'La tarjeta queda junto a la tarjeta de crédito y el pase de abordar, no en una gaveta ni entre los recibos.',
  },
  {
    titulo: 'Se actualiza sola',
    texto:
      'Acreditás puntos o cambiás una promoción y la tarjeta se refresca en el teléfono del cliente, sin que él haga nada.',
  },
  {
    titulo: 'Dejás de adivinar',
    texto:
      'Visitas, clientes nuevos y premios canjeados, por sucursal y por período: vas a saber qué promoción sirvió.',
  },
  {
    titulo: 'Varias sucursales, un solo programa',
    texto:
      'Cada local con su cajero y su propio corte, todos bajo la misma tarjeta y el mismo saldo del cliente.',
  },
  {
    titulo: 'Cero fricción para el cliente',
    texto:
      'Nada que descargar, nada que recordar, ninguna contraseña. La billetera ya viene en su teléfono.',
  },
  {
    titulo: 'El diseño es tuyo',
    texto:
      'Tus colores y tu logo en su pantalla cada vez que abre la billetera. No es nuestra marca la que se luce.',
  },
];

export default function Inicio() {
  return (
    <div className={estilos.pagina}>
      {/* La cabecera comparte el campo de brasa con el hero: arriba del todo se leen como una sola
          superficie (la barra desaparece), y al bajar queda una franja de marca sobre el fondo del
          tema. Por eso no lleva borde ni vidrio esmerilado: el color ya es la separación. */}
      <header className={estilos.cabecera}>
        <div className={`${estilos.envoltura} ${estilos.cabeceraFila}`}>
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
        </div>
      </header>

      <main>
        <section className={estilos.hero}>
          <div className={`${estilos.envoltura} ${estilos.heroRejilla}`}>
            <div className={estilos.heroTexto}>
              <h1 className={estilos.heroTitulo}>
                Tu tarjeta de lealtad, <em>en el teléfono</em> de tus clientes
              </h1>
              <p className={estilos.heroLinea}>
                Suman sellos o puntos en cada visita, sin instalar nada y sin cargar plásticos.
              </p>
              <a className={estilos.botonBrasa} href="#demo">
                Agendá tu demo
              </a>
              <p className={estilos.heroNota}>
                Te la mostramos con tus colores y tu logo, sin compromiso.
              </p>
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

        <section id="como-funciona" className={`${estilos.seccion} ${estilos.envoltura}`}>
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
        </section>

        <section className={`${estilos.seccion} ${estilos.envoltura}`}>
          <h2 className={estilos.tituloSeccion}>Qué gana tu negocio</h2>
          <p className={estilos.textoSeccion}>
            Un programa de lealtad sirve cuando el cliente lo lleva encima.
          </p>
          {/* Antes eran seis cajas idénticas en grilla. Ahora es una lista de definiciones con
              filas regladas: seis afirmaciones se escanean de un vistazo, seis cards no. */}
          <dl className={estilos.razones}>
            {RAZONES.map((razon) => (
              <div key={razon.titulo} className={estilos.razon}>
                <dt>{razon.titulo}</dt>
                <dd>{razon.texto}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="demo" className={`${estilos.seccion} ${estilos.envoltura}`}>
          <div className={estilos.demo}>
            <div>
              <h2 className={estilos.tituloSeccion}>Agendá tu demo</h2>
              <p className={estilos.textoSeccion}>
                Contanos de tu negocio y te escribimos para mostrarte cómo se vería tu tarjeta
                funcionando de verdad.
              </p>
              <ul className={estilos.lista} role="list">
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
          <span>{MARCA.nombre}, tarjetas de lealtad digitales en El Salvador</span>
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
