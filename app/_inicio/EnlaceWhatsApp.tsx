'use client';

import { dispararEvento } from '@/lib/marketing/eventosMeta';
import { numeroWhatsAppValido } from '@/lib/marketing/pixelMeta';

// Enlace a WhatsApp de Cardly que dispara Contact de Meta al tocarlo. Cada toque es un contacto:
// abre WhatsApp en otra pestaña o en la app, y la página se queda donde estaba.
//
// El número sale de NEXT_PUBLIC_WHATSAPP_CARDLY (formato internacional, ej. 50370001234). Hasta el
// 2026-09-13 no había un número público de Cardly y el ícono del pie era decorativo: sin la
// variable todo sigue exactamente así (`alternativa`, o nada). No se inventa un número.
const NUMERO = numeroWhatsAppValido(process.env.NEXT_PUBLIC_WHATSAPP_CARDLY);

export default function EnlaceWhatsApp({
  children,
  etiqueta,
  prefijo,
  alternativa = null,
  className,
}: {
  children: React.ReactNode;
  // Nombre accesible cuando el contenido es solo un ícono.
  etiqueta?: string;
  // Texto que va ANTES del enlace y que solo tiene sentido si el enlace existe (" o por ").
  prefijo?: string;
  alternativa?: React.ReactNode;
  className?: string;
}) {
  if (!NUMERO) return <>{alternativa}</>;

  return (
    <>
      {prefijo}
      <a
        className={className}
        href={`https://wa.me/${NUMERO}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={etiqueta}
        onClick={() => dispararEvento('Contact', { content_name: 'WhatsApp' })}
      >
        {children}
      </a>
    </>
  );
}
