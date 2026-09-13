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

// Las fechas se formatean con el de vigencia.ts, que es el único (ver ahí por qué el mediodía UTC).
import { formatearFecha } from './vigencia';

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
  // ¿Alguna operación de este tipo pasa por `acreditar_atomico`? Es LA pregunta que decide si las
  // cuatro perillas antifraude del comercio (tope diario, espera mínima, techo por transacción,
  // tope diario de puntos) tienen dónde aplicarse: viven DENTRO de esa función (migración 0015) y
  // NINGUNA otra las consulta —— se verificó una por una en 0019 (usar_cupon_atomico,
  // renovar_membresia_atomico), 0020 (usar_visita_atomico), 0022 (consumir_saldo_atomico) y 0023
  // (registrar_compra_atomico).
  //
  // Es un campo del catálogo y no una lista aparte por lo mismo que `unidadPrograma` deriva del
  // `contador`: un noveno tipo no compila hasta que alguien decida su valor, así que no puede
  // heredar "sí, aplican" por descuido —— que es justo cómo cupón y membresía terminaron
  // ofreciéndole al dueño perillas que su tarjeta nunca consulta.
  aplicanControlesAcreditacion: boolean;
  // ¿Alguna operación de este tipo le ENTREGA el monto de la compra a su RPC? Es LA pregunta que
  // decide si la perilla `pedir_monto_compra` sirve de algo: si la respuesta es no, el cajero teclea
  // un dato que se tira a la basura. Se verificó firma por firma: acreditar_atomico (0015) recibe
  // p_monto_compra y lo graba en el ledger; consumir_saldo_atomico (0022) recibe p_monto;
  // registrar_compra_atomico (0023) recibe p_monto_centavos; usar_cupon_atomico y
  // renovar_membresia_atomico (0019, redefinida en 0031 con la misma firma) y usar_visita_atomico
  // (0020) NO reciben ningún monto.
  //
  // No es `requiereMonto`: ese es "lo EXIGE", y puntos y sellos lo usan sin exigirlo. No es
  // `aplicanControlesAcreditacion`: descuento no pasa por acreditar_atomico y sí usa el monto. Y no
  // es `usaVigencia`, aunque hoy separe casi lo mismo: una pregunta si el estado es una fecha y la
  // otra qué recibe la función del mostrador. Un campo propio por la misma razón que el anterior:
  // un noveno tipo no compila hasta que alguien decida si su operación recibe el monto.
  usaMontoDeCompra: boolean;
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
    // Su operación principal ES acreditar_atomico.
    aplicanControlesAcreditacion: true,
    // acreditar_atomico (0015) recibe p_monto_compra; el escáner se lo pasa cuando viene tecleado.
    usaMontoDeCompra: true,
  },
  {
    valor: 'sellos',
    etiqueta: 'Sellos',
    descripcion: 'El clásico: junta N sellos y se gana el premio.',
    contador: 'entero',
    accionPrincipal: 'acreditar',
    requiereMonto: false,
    usaVigencia: false,
    // Su operación principal ES acreditar_atomico.
    aplicanControlesAcreditacion: true,
    // Mismo camino que puntos: acreditar_atomico (0015) recibe p_monto_compra.
    usaMontoDeCompra: true,
  },
  {
    valor: 'prepago',
    etiqueta: 'Prepago',
    descripcion: 'El cliente compra un paquete de visitas y las va usando.',
    contador: 'entero',
    accionPrincipal: 'consumir',
    requiereMonto: false,
    usaVigencia: false,
    // Consume por usar_visita_atomico (0020), que no mira las perillas —— pero VENDER el
    // paquete reusa acreditarPuntos, así que los límites siguen siendo la defensa de esa carga.
    aplicanControlesAcreditacion: true,
    // El que NO se ve a simple vista. usar_visita_atomico (0020) no recibe monto, y vender el
    // paquete pasa por acreditar_atomico —que sí tiene p_monto_compra— pero accionOperacionSecundaria
    // llama a venderPaquete solo con sucursal y cajero: el monto no llega nunca. Si algún día se
    // cablea en la venta, este valor cambia junto con esa llamada, no antes.
    usaMontoDeCompra: false,
  },
  {
    valor: 'gift_card',
    etiqueta: 'Gift card',
    descripcion: 'Saldo cargado por adelantado que el cliente va gastando.',
    contador: 'centavos',
    accionPrincipal: 'consumir',
    requiereMonto: true,
    usaVigencia: false,
    // Cobra por consumir_saldo_atomico (0022), que no mira las perillas —— pero CARGAR saldo
    // reusa acreditarPuntos, y el techo por transacción es lo único que impide que un cajero
    // regale una gift card de $500.
    aplicanControlesAcreditacion: true,
    // consumir_saldo_atomico (0022) recibe p_monto: el monto ES lo que se descuenta del saldo.
    usaMontoDeCompra: true,
  },
  {
    valor: 'cashback',
    etiqueta: 'Cashback',
    descripcion: 'Un porcentaje de cada compra vuelve como saldo.',
    contador: 'centavos',
    accionPrincipal: 'acreditar',
    requiereMonto: true,
    usaVigencia: false,
    // La devolución se acredita por acreditar_atomico.
    aplicanControlesAcreditacion: true,
    // acreditarCashback calcula el porcentaje sobre el monto y se lo pasa a acreditar_atomico (0015)
    // como p_monto_compra.
    usaMontoDeCompra: true,
  },
  {
    valor: 'cupon',
    etiqueta: 'Cupón',
    descripcion: 'Una oferta de una sola vez, con fecha de vencimiento.',
    contador: 'ninguno',
    accionPrincipal: 'usar',
    requiereMonto: false,
    usaVigencia: true,
    // usar_cupon_atomico (0019) no consulta ninguna perilla, y no hay segunda operación.
    aplicanControlesAcreditacion: false,
    // usar_cupon_atomico (0019) recibe comercio, tarjeta, sucursal y cajero. Ningún monto.
    usaMontoDeCompra: false,
  },
  {
    valor: 'membresia',
    etiqueta: 'Membresía',
    descripcion: 'El cliente paga por pertenecer y renueva cada cierto tiempo.',
    contador: 'ninguno',
    accionPrincipal: 'renovar',
    requiereMonto: false,
    usaVigencia: true,
    // renovar_membresia_atomico (0019) no consulta ninguna perilla, y no hay segunda operación.
    aplicanControlesAcreditacion: false,
    // renovar_membresia_atomico (0019, y la 0031 la redefine con la MISMA firma) recibe comercio,
    // tarjeta, sucursal y cajero. Ningún monto: la renovación no guarda cuánto se cobró.
    usaMontoDeCompra: false,
  },
  {
    valor: 'descuento',
    etiqueta: 'Descuento por nivel',
    descripcion: 'Entre más gasta el cliente, mayor su descuento permanente.',
    contador: 'ninguno',
    accionPrincipal: 'registrar',
    requiereMonto: true,
    usaVigencia: false,
    // registrar_compra_atomico (0023) no consulta ninguna perilla, y no hay segunda operación.
    aplicanControlesAcreditacion: false,
    // registrar_compra_atomico (0023) recibe p_monto_centavos: el monto ES lo que acumula el nivel.
    usaMontoDeCompra: true,
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

// ¿Tiene sentido ofrecerle premios a este tipo? Un premio se canjea DESCONTANDO `puntos_actuales`
// (canjear_recompensa_atomico, 0009), así que sin contador no hay de dónde descontar: en cupón,
// membresía y descuento el botón "Canjear" del escáner sale deshabilitado en todos los premios,
// siempre.
//
// Existe como función y no como `tipo.contador !== 'ninguno'` escrito a mano porque la decisión ya
// estaba en TRES pantallas (el escáner, la pantalla de recompensas y el atajo de la ficha del
// cliente), y tres copias de una regla son tres oportunidades de que una se quede vieja.
export function puedeCanjearRecompensas(tipoTarjeta: string): boolean {
  return tipoOPuntos(tipoTarjeta).contador !== 'ninguno';
}

// ¿Sirve de algo configurarle a este comercio las perillas antifraude? Ver el campo homónimo del
// catálogo: la respuesta es "alguna de sus operaciones pasa por acreditar_atomico".
//
// NO se fusiona con puedeCanjearRecompensas aunque hoy devuelvan lo mismo: una pregunta si hay
// contador del que descontar y la otra por qué RPC viaja la operación. Un tipo nuevo que renueve
// por acreditar_atomico sin contador las separaría.
export function aplicanControlesAcreditacion(tipoTarjeta: string): boolean {
  return tipoOPuntos(tipoTarjeta).aplicanControlesAcreditacion;
}

// ¿Tiene sentido pedirle al cajero el monto de la compra en este tipo? Ver el campo homónimo del
// catálogo: la respuesta es "alguna de sus operaciones se lo entrega a su RPC".
//
// Hay DOS preguntas distintas que la usan y no hay que confundirlas: Reglas pregunta por el programa
// PRINCIPAL (si ofrecerle la perilla al dueño), y el escáner pregunta por la TARJETA escaneada (si
// mostrar el campo), porque un comercio de puntos puede tener además un programa de cupón.
export function usaMontoDeCompra(tipoTarjeta: string): boolean {
  return tipoOPuntos(tipoTarjeta).usaMontoDeCompra;
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
