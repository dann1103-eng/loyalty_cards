// Set de íconos de línea propio para la página pública, calcado del estilo del mockup (trazo
// parejo, esquinas redondeadas, sin relleno). No son de una librería porque son pocos y muy
// específicos de esta página; traer una dependencia entera por seis glifos sería al revés.
// Todos van con aria-hidden desde donde se usan: son refuerzo visual de un texto que ya dice lo
// mismo, nunca la única fuente de la información.

type PropsIcono = { className?: string; style?: React.CSSProperties };

function Svg({ children, className, style }: { children: React.ReactNode } & PropsIcono) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function IconoPersonas({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M2.5 20c0-3.3 2.5-5.5 5.5-5.5S13.5 16.7 13.5 20" />
      <path d="M12.5 14.8c2.6.4 4.5 2.4 4.5 5.2" />
    </Svg>
  );
}

export function IconoTarjeta({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </Svg>
  );
}

export function IconoRayo({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconoSello({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M10 3.5h4l1.5 6H8.5L10 3.5Z" />
      <path d="M7.5 9.5h9l1.5 4h-12l1.5-4Z" />
      <path d="M4.5 19.5h15" />
      <path d="M6.5 13.5v6M17.5 13.5v6" />
    </Svg>
  );
}

export function IconoLibreta({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <rect x="5.5" y="3" width="13" height="18" rx="1.5" />
      <path d="M8.5 3v18M9 7.5h6M9 11h6M9 14.5h4" />
    </Svg>
  );
}

export function IconoCalculadora({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <rect x="4.5" y="3" width="15" height="18" rx="2" />
      <path d="M7.5 7.5h9M7.5 12h1.6M11.2 12h1.6M14.9 12h1.6M7.5 15.6h1.6M11.2 15.6h1.6M7.5 19h1.6" />
      <path d="M14.9 15.6v3.4M13.1 17.3h3.6" />
    </Svg>
  );
}

export function IconoChat({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M3.5 6.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-3.5 3v-3H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
      <path d="M12.5 4.5h6a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-.5" />
    </Svg>
  );
}

export function IconoPin({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M12 21s7-6.4 7-11.5A7 7 0 0 0 5 9.5C5 14.6 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </Svg>
  );
}

export function IconoX({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function IconoFlecha({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Svg>
  );
}

export function IconoCheck({ className, style }: PropsIcono) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 12.5 10.5 15.5 16.5 8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconoInstagram({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="0.6" fill="currentColor" />
    </Svg>
  );
}

export function IconoTikTok({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.4 2.4 2.1 4 4.5 4.3" />
    </Svg>
  );
}

export function IconoWhatsApp({ className, style }: PropsIcono) {
  return (
    <Svg className={className} style={style}>
      <path d="M6.5 17.5 4.5 19.5 5 15.7A7.5 7.5 0 1 1 8.4 18.3Z" />
      <path d="M9 10.5c0 2.5 2 4.5 4.5 4.5" />
    </Svg>
  );
}

// El garabato que subraya "PASATE AL CLUB": dos trazos sueltos, no una línea recta.
export function IconoGarabato({ className, style }: PropsIcono) {
  return (
    <svg className={className} style={style} viewBox="0 0 120 20" fill="none">
      <path
        d="M2 14C20 4 40 4 58 10s38 6 60-4"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
