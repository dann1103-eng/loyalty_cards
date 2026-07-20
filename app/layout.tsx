import type { Metadata } from "next";
import { Outfit, Hanken_Grotesk, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "FM Lealtad",
  description:
    "Tarjetas de lealtad digitales para tu comercio — puntos y sellos directo en la billetera del teléfono.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${outfit.variable} ${hanken.variable} ${geistMono.variable}`}>
      <head>
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
