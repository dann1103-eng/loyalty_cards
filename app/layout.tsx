import type { Metadata } from "next";
import { Outfit, Hanken_Grotesk, Geist_Mono, Permanent_Marker, Anton } from "next/font/google";
import { SCRIPT_TEMA, TEMA_POR_DEFECTO } from "@/lib/tema";
import { MARCA } from "@/lib/marca";
import { DESCRIPCION_SITIO, facebookDe, openGraphDe, twitterDe } from "@/lib/metadatosOg";
import "./globals.css";

// Sistema Stitch (docs/design/C1-C7): Outfit para display/marca, Hanken Grotesk para cuerpo,
// Geist Mono para números (puntos, sellos, teléfonos, códigos).
const outfit = Outfit({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

// Solo para el acento tipo marcador de la página pública ("funciona", "GRATIS", "para crecer"):
// el mockup de `/` repite ese trazo suelto sobre el título en bloque en casi cada sección, y
// replicarlo pide una familia de veras distinta, no Outfit en cursiva. No se usa en ningún panel.
//
// SUSTITUTO CONSCIENTE: el kit de marca (INSUMOS/Tipografías/Subheading) trae Devina Garden para
// este rol, que no está en Google Fonts. Permanent Marker es lo más cercano disponible sin
// self-hostear. Si se quiere la de verdad, hay que meter el .ttf/.woff2 en app/fonts y pasar a
// next/font/local — no es un cambio de diseño, es un cambio de archivo.
const marcador = Permanent_Marker({
  variable: "--font-marcador",
  subsets: ["latin"],
  weight: ["400"],
});

// Titulares de la página pública. Es LA fuente de titular del kit de marca
// (INSUMOS/Tipografías/HEADING/Anton.zip) y está en Google Fonts, así que se usa desde acá en vez
// de self-hostearla. Condensada, pesadísima y solo en un peso: es exactamente el bloque de
// mayúsculas del mockup, que Outfit 700 no lograba (Outfit es más ancha y más redonda).
// Sigue siendo SOLO de la página pública: los paneles conservan Outfit para no cambiarles la
// identidad por un pase de diseño de otra superficie.
const anton = Anton({
  variable: "--font-titular",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  // metadataBase es OBLIGATORIO para que OpenGraph funcione: las redes sociales no resuelven rutas
  // relativas, necesitan una URL absoluta, y sin esto Next emite la ruta tal cual y el scraper no
  // encuentra la imagen.
  //
  // ══ CON `www`, SIEMPRE ══ Se arma desde MARCA.sitio (que ya incluye el www) y no a mano. El apex
  // `cardly-sv.site` y el `www` sirven los dos directo, sin redirect entre ellos — es un requisito
  // de Apple Wallet, documentado en CLAUDE.md. Poner acá el apex haría que cada enlace compartido
  // anunciara un host distinto del que quedó grabado en los passes.
  metadataBase: new URL(`https://${MARCA.sitio}`),
  title: {
    // Cada página pone su título y se le agrega la marca al final; la landing usa `absolute` para
    // no quedar como "Cardly SV — … · Cardly SV".
    default: MARCA.nombre,
    template: `%s · ${MARCA.nombre}`,
  },
  description: DESCRIPCION_SITIO,
  openGraph: openGraphDe({ titulo: MARCA.nombre }),
  twitter: twitterDe({ titulo: MARCA.nombre }),
  // Solo aparece si FACEBOOK_APP_ID está puesta; ver facebookDe() para por qué el aviso del
  // depurador de Facebook no bloquea nada.
  facebook: facebookDe(),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${outfit.variable} ${hanken.variable} ${geistMono.variable} ${marcador.variable} ${anton.variable}`}
      // El servidor no puede saber qué tema eligió este dispositivo (vive en localStorage), así que
      // sirve SIEMPRE el por defecto y el script de abajo lo corrige antes del primer pintado. Sin
      // suppressHydrationWarning React vería que el atributo del DOM no coincide con el que él
      // renderizó, lo trataría como error de hidratación y volvería a montar desde el boundary más
      // cercano — perdiendo la corrección del script y devolviendo el destello que vino a evitar.
      data-tema={TEMA_POR_DEFECTO}
      suppressHydrationWarning
    >
      <head>
        {/* ANTI-DESTELLO DE TEMA. Corre SÍNCRONO mientras el navegador parsea el <head>, o sea
            antes del primer pintado y mucho antes de que React hidrate. Con useEffect el usuario
            vería el panel oscuro y después el salto a claro en cada carga; useLayoutEffect tampoco
            alcanza (corre después de hidratar, y en una conexión lenta el navegador ya pintó el
            HTML del servidor). Patrón documentado en
            node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
            OJO si algún día se agrega una CSP estricta: un script en línea necesita nonce. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        {/* Íconos Material Symbols (mismos que el diseño de Stitch). Va en el layout RAÍZ (App
            Router: aplica a todo el árbol; la regla no-page-custom-font apunta a pages/, no aplica).
            display=block a propósito: con swap se vería el nombre crudo del ícono ("storefront")
            hasta que cargue la fuente — peor que un parpadeo en blanco. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/google-font-display, @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0&display=block"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
