import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mi Tarjeta — FM Lealtad',
  // Emite <meta name="mobile-web-app-capable" content="yes">, el título de la web-app y el estilo
  // de la barra de estado en iOS. Junto con apple-icon.tsx, hace que "Agregar a inicio" en Safari
  // use nuestro ícono y abra en modo standalone. NO implica que Safari lo ofrezca solo (ver el
  // copy honesto de la página).
  appleWebApp: {
    capable: true,
    title: 'Mi Tarjeta',
    statusBarStyle: 'black-translucent',
  },
};

export default function LayoutMiTarjeta({ children }: { children: React.ReactNode }) {
  return children;
}
