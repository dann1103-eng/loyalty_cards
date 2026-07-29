// El catálogo de tipos de tarjeta y, sobre todo, EL ÚNICO lugar que convierte el contador crudo en
// texto para una persona.
//
// Por qué existe este módulo: desde la migración 0018, `tarjetas.puntos_actuales` es un contador
// universal cuyo significado depende del tipo — en sellos son sellos, en prepago son visitas que
// quedan, y en cashback y gift card son CENTAVOS. Un `1250` es "$12.50" o "1250 puntos" según el
// comercio. Cualquier pantalla que imprima el número crudo va a mostrarle plata equivocada a un
// cliente, y eso no lo atrapa el typechecker: los dos son `number`.
//
// La defensa es que haya un solo formateador y que sepa todo lo que necesita saber.

export type Contador = 'ninguno' | 'entero' | 'centavos';

// Qué hace el cajero con esta tarjeta cuando escanea. Es lo que decide qué botón ve.
export type AccionPrincipal = 'acreditar' | 'consumir' | 'usar' | 'renovar' | 'registrar';

export interface TipoTarjeta {
  valor: string;
  etiqueta: string;
  descripcion: string;
  contador: Contador;
  accionPrincipal: AccionPrincipal;
  // Si es true, el escáner EXIGE el monto de la compra: sin él no hay porcentaje que calcular ni
  // gasto que acumular. Convierte la perilla opcional `pedir_monto_compra` (Tanda 1) en obligatoria.
  requiereMonto: boolean;
  // Si es true, el estado de la tarjeta es una fecha, no un número.
  usaVigencia: boolean;
}

export const TIPOS: readonly TipoTarjeta[] = [
  {
    valor: 'puntos',
    etiqueta: 'Puntos',
    descripcion: 'El cliente acumula puntos y los canjea por recompensas.',
    contador: 'entero',
    accionPrincipal: 'acreditar',
    requiereMonto: false,
    usaVigencia: false,
  },
  {
    valor: 'sellos',
    etiqueta: 'Sellos',
    descripcion: 'El clásico: junta N sellos y se gana el premio.',
    contador: 'entero',
    accionPrincipal: 'acreditar',
    requiereMonto: false,
    usaVigencia: false,
  },
  {
    valor: 'prepago',
    etiqueta: 'Prepago',
    descripcion: 'El cliente compra un paquete de visitas y las va usando.',
    contador: 'entero',
    accionPrincipal: 'consumir',
    requiereMonto: false,
    usaVigencia: false,
  },
  {
    valor: 'gift_card',
    etiqueta: 'Gift card',
    descripcion: 'Saldo cargado por adelantado que el cliente va gastando.',
    contador: 'centavos',
    accionPrincipal: 'consumir',
    requiereMonto: true,
    usaVigencia: false,
  },
  {
    valor: 'cashback',
    etiqueta: 'Cashback',
    descripcion: 'Un porcentaje de cada compra vuelve como saldo.',
    contador: 'centavos',
    accionPrincipal: 'acreditar',
    requiereMonto: true,
    usaVigencia: false,
  },
  {
    valor: 'cupon',
    etiqueta: 'Cupón',
    descripcion: 'Una oferta de una sola vez, con fecha de vencimiento.',
    contador: 'ninguno',
    accionPrincipal: 'usar',
    requiereMonto: false,
    usaVigencia: true,
  },
  {
    valor: 'membresia',
    etiqueta: 'Membresía',
    descripcion: 'El cliente paga por pertenecer y renueva cada cierto tiempo.',
    contador: 'ninguno',
    accionPrincipal: 'renovar',
    requiereMonto: false,
    usaVigencia: true,
  },
  {
    valor: 'descuento',
    etiqueta: 'Descuento por nivel',
    descripcion: 'Entre más gasta el cliente, mayor su descuento permanente.',
    contador: 'ninguno',
    accionPrincipal: 'registrar',
    requiereMonto: true,
    usaVigencia: false,
  },
] as const;

export function buscarTipo(valor: string): TipoTarjeta | null {
  return TIPOS.find((t) => t.valor === valor) ?? null;
}

// Fallback a 'puntos' y no un throw: un tipo desconocido en la BD (una fila vieja, un valor escrito
// a mano) no debe dejar a un cliente sin poder ver su tarjeta. Se degrada al comportamiento más
// simple y conservador.
export function tipoOPuntos(valor: string): TipoTarjeta {
  return buscarTipo(valor) ?? TIPOS[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Dinero
// ─────────────────────────────────────────────────────────────────────────────
// Centavos ↔ texto. Entero siempre: sumar 0.1 + 0.2 repetidas veces acumula error, y esto es el
// saldo de un cliente.

export function formatearCentavos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const abs = Math.abs(Math.round(centavos));
  return `${signo}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// "12.50" → 1250. Devuelve null si el texto no es un monto válido: el caller decide qué hacer, en
// vez de recibir un NaN que después se guarda como saldo.
export function centavosDesdeTexto(texto: string): number | null {
  const limpio = texto.trim().replace(/[$\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  // Se multiplica sobre el string partido, no sobre el float: Number('19.99') * 100 da
  // 1998.9999999999998, y Math.round lo salva por poco — pero no en todos los valores.
  const [enteros, decimales = ''] = limpio.split('.');
  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Descripción del estado
// ─────────────────────────────────────────────────────────────────────────────

export interface EstadoTarjeta {
  tipo: string;
  // `tarjetas.puntos_actuales`. Su significado depende del tipo — ver el encabezado.
  contador: number;
  selloMeta?: number | null;
  vigenciaHasta?: string | null;
  usadoEn?: string | null;
  // Para 'descuento': el porcentaje ya resuelto desde niveles_descuento. null = todavía sin nivel.
  porcentajeDescuento?: number | null;
}

function formatearFecha(iso: string): string {
  return new Intl.DateTimeFormat('es-SV', { dateStyle: 'long' }).format(
    new Date(`${iso.slice(0, 10)}T12:00:00Z`),
  );
}

// ¿Sigue vigente una fecha AAAA-MM-DD? Se compara como TEXTO contra la fecha de hoy, no como Date:
// "vence el 30" tiene que significar el 30 completo, y comparar instantes hace que venza a
// medianoche UTC — las 6 de la tarde del 29 en El Salvador.
export function sigueVigente(vigenciaHasta: string | null | undefined, hoyIso: string): boolean {
  if (!vigenciaHasta) return false;
  return vigenciaHasta.slice(0, 10) >= hoyIso.slice(0, 10);
}

// EL formateador. Todo lo que muestre un saldo a una persona pasa por acá.
//
// `hoyIso` entra por argumento y no se llama a new Date() adentro: así la función es pura y se
// puede probar el borde del vencimiento sin congelar el reloj.
export function describirSaldo(estado: EstadoTarjeta, hoyIso: string): string {
  const tipo = tipoOPuntos(estado.tipo);

  if (tipo.valor === 'cupon') {
    if (estado.usadoEn) return 'Ya usado';
    if (!estado.vigenciaHasta) return 'Disponible';
    return sigueVigente(estado.vigenciaHasta, hoyIso)
      ? `Disponible hasta el ${formatearFecha(estado.vigenciaHasta)}`
      : `Venció el ${formatearFecha(estado.vigenciaHasta)}`;
  }

  if (tipo.valor === 'membresia') {
    if (!estado.vigenciaHasta) return 'Sin activar';
    return sigueVigente(estado.vigenciaHasta, hoyIso)
      ? `Activa hasta el ${formatearFecha(estado.vigenciaHasta)}`
      : `Vencida el ${formatearFecha(estado.vigenciaHasta)}`;
  }

  if (tipo.valor === 'descuento') {
    return estado.porcentajeDescuento
      ? `${estado.porcentajeDescuento}% de descuento`
      : 'Sin descuento todavía';
  }

  if (tipo.contador === 'centavos') {
    return `${formatearCentavos(estado.contador)} disponibles`;
  }

  if (tipo.valor === 'prepago') {
    const n = estado.contador;
    return n === 1 ? '1 visita disponible' : `${n} visitas disponibles`;
  }

  if (tipo.valor === 'sellos') {
    return estado.selloMeta != null
      ? `${estado.contador} de ${estado.selloMeta} sellos`
      : `${estado.contador} sellos`;
  }

  return `${estado.contador} ${estado.contador === 1 ? 'punto' : 'puntos'}`;
}

// El porcentaje que le toca a un acumulado, dado los niveles del comercio. Gana el umbral más alto
// que el cliente ya superó. `null` = todavía no llegó a ninguno.
export function nivelParaAcumulado(
  acumuladoCentavos: number,
  niveles: { desdeCentavos: number; porcentaje: number }[],
): number | null {
  const alcanzados = niveles.filter((n) => acumuladoCentavos >= n.desdeCentavos);
  if (alcanzados.length === 0) return null;
  return alcanzados.reduce((mejor, n) => (n.desdeCentavos > mejor.desdeCentavos ? n : mejor)).porcentaje;
}
