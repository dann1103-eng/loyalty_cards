// Rango de fechas de los filtros de reportes. Módulo PURO (sin BD ni JSX) para poder probar los
// bordes sin montar nada — mismo criterio que atribucionEscaner.ts y agregados.ts.
//
// Las fechas vienen de dos <input type="date"> por querystring, así que llegan como texto y pueden
// ser cualquier cosa: vacías, con formato raro, o al revés (desde > hasta). Nada de eso debe llegar
// al RPC: `reporte_cajeros` las interpreta en la zona horaria del comercio y una fecha inválida
// haría fallar el cast.
//
// ══ CALENDARIO, NO HORAS ══
// Todo "N días atrás" se calcula sobre la FECHA local (AAAA-MM-DD) con aritmética de calendario, nunca
// restando 24 h a un instante. Un día no siempre dura 24 horas: en una zona con horario de verano
// (Europe/Madrid, las de EE.UU.) el día del cambio dura 23 o 25, y restar 24 h desde cerca de la
// medianoche cae en el día equivocado. Así lo hacía rangoUltimosDias hasta la entrega de Reportes con
// filtros (2026-09-23), y la pantalla de cajeros lo usaba: "7 días" a las 23:30 del 25 de octubre en
// Madrid empezaba el 20 y no el 19.
//
// Los dos ladrillos de calendario son los de vigencia.ts (el módulo de los días de calendario del
// proyecto), no copias: `sumarDias` (aritmética en UTC, sin horario de verano) y `hoyEnZona` (el día
// del reloj de pared de una zona, con Intl y la zona explícita, nunca la del proceso). Se verificó
// antes de importarlos que dan lo mismo que las copias que hubo acá, en Bogotá, Madrid (los dos
// cambios de hora), El Salvador y Tokio. Dos diferencias, ninguna alcanzable desde acá: `sumarDias`
// también acepta un timestamp (toma los 10 primeros caracteres), y `hoyEnZona` con una zona VACÍA o
// null cae a America/El_Salvador donde la copia lanzaba; resolverFiltrosReportes ya valida la zona
// antes (con el mismo respaldo, ZONA_HORARIA_DEFAULT), y la pantalla de cajeros pasa la de la base,
// que respalda el CHECK de la 0015. Una zona no vacía pero inválida lanza en las dos.
import { hoyEnZona, sumarDias } from '@/lib/tarjetas/vigencia';

export interface RangoFechas {
  desde: string | null;
  hasta: string | null;
}

const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

// El piso de cualquier fecha de un filtro de reportes (spec 2026-09-23 §1). Una fecha anterior es un
// disparate en cualquier pantalla —el sistema nació en 2026— y del lado del Excel, antes de 1900 ni
// siquiera hay número de serie. Comparar el texto AAAA-MM-DD contra este es comparar fechas: el orden
// lexicográfico de ese formato ES el cronológico.
export const FECHA_MINIMA = '2000-01-01';

// Valida una fecha AAAA-MM-DD contra el calendario real: el round-trip por Date atrapa un 2026-02-31
// (que JS "corrige" a marzo) y un 0000-01-01. Mismo chequeo que validarDatosCuenta usa para
// licencia_activa_desde. (El piso de 2000 NO va acá sino en limpiarFecha: es una política de los
// reportes, no una propiedad de "ser una fecha", y así este validador sigue diciendo lo mismo que el
// de cuentas.ts.)
export function esFechaValida(valor: string): boolean {
  if (!FORMATO.test(valor)) return false;
  // El año 0000 EXISTE en ISO 8601, así que pasa el formato y el round-trip sin problema. Se
  // rechaza aparte porque como filtro de un reporte es un disparate, y porque validarDatosCuenta ya
  // lo rechaza para licencia_activa_desde: dos validadores de fecha que discrepan en el mismo repo
  // es una trampa esperando a que alguien la pise.
  if (valor.startsWith('0000')) return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return false;
  return fecha.toISOString().slice(0, 10) === valor;
}

// Lo que llegó por querystring como fecha de un filtro: la fecha si es real y no anterior al piso;
// null (= sin ese borde) si no. Recorta espacios: un <input type="date"> no los manda, pero una URL
// escrita a mano sí.
export function limpiarFecha(valor: string | undefined): string | null {
  const texto = (valor ?? '').trim();
  return texto && esFechaValida(texto) && texto >= FECHA_MINIMA ? texto : null;
}

// Convierte lo que llegó por querystring en un rango usable. Una fecha ilegible se descarta (queda
// null = sin ese borde) en vez de rechazar la pantalla entera: un filtro mal tecleado no debería
// dejar al dueño sin poder ver nada.
//
// Si el rango viene invertido se INTERCAMBIA en lugar de vaciarse: es casi siempre un error de
// tecleo, y devolver el rango que el dueño evidentemente quiso ver es mejor que devolver vacío.
export function resolverRangoFechas(
  desdeCrudo: string | undefined,
  hastaCrudo: string | undefined,
): RangoFechas {
  let desde = limpiarFecha(desdeCrudo);
  let hasta = limpiarFecha(hastaCrudo);

  if (desde && hasta && desde > hasta) {
    [desde, hasta] = [hasta, desde];
  }

  return { desde, hasta };
}

// Rango por defecto de la pantalla: los últimos `dias` días contando hoy, en la zona del comercio.
// `ahora` se pasa como argumento (no se llama a new Date() adentro) para que la función sea pura y
// probable sin congelar el reloj.
export function rangoUltimosDias(ahora: Date, dias: number, zonaHoraria: string): RangoFechas {
  const cuantos = Math.max(1, Math.floor(dias));
  const hoy = hoyEnZona(zonaHoraria, ahora);
  return { desde: sumarDias(hoy, -(cuantos - 1)), hasta: hoy };
}

// Completa lo que falte de un rango PEDIDO (ya pasado por resolverRangoFechas) con el de por defecto,
// y nunca devuelve desde > hasta. Lo usa la pantalla de cajeros.
//
// El caso que la rompió: `?desde=1999-06-01&hasta=2026-01-15`. Con el piso de 2000 el desde cae como
// si no estuviera, el default lo completaba con "hace 30 días", y quedaba DESPUÉS del hasta: la
// consulta devolvía vacío, y ese enlace antes andaba (1999 era, en la práctica, "sin borde"). Un
// borde que vino del DEFAULT y choca con uno pedido se suelta (null = sin ese borde) en vez de
// invertir el rango: lo que el dueño escribió manda. Si los dos se pidieron al revés (solo si alguien
// no pasó por resolverRangoFechas), se dan vuelta, como allá.
export function completarRango(pedido: RangoFechas, porDefecto: RangoFechas): RangoFechas {
  const desde = pedido.desde ?? porDefecto.desde;
  const hasta = pedido.hasta ?? porDefecto.hasta;
  if (desde !== null && hasta !== null && desde > hasta) {
    if (pedido.desde === null) return { desde: null, hasta };
    if (pedido.hasta === null) return { desde, hasta: null };
    return { desde: hasta, hasta: desde };
  }
  return { desde, hasta };
}

// ─────────────────────────────────────────────────────────────────────────────
// Períodos de Reportes (spec 2026-09-23 §1)
// ─────────────────────────────────────────────────────────────────────────────

// Confirmados por Daniel el 2026-09-23: los seis del resumen aprobado más "Desde siempre" (`todo`),
// que conserva la vista histórica que hoy tienen la cabecera y las cartas; 30 días por defecto.
export const PERIODOS = ['hoy', 'ayer', '7d', '30d', 'mes', 'todo', 'rango'] as const;
export type Periodo = (typeof PERIODOS)[number];
export const PERIODO_POR_DEFECTO: Periodo = '30d';

// El rótulo de cada período, para los chips de la pantalla y la hoja Resumen del Excel: una sola
// lista para que los dos digan lo mismo.
export const ETIQUETA_PERIODO: Record<Periodo, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  '7d': '7 días',
  '30d': '30 días',
  mes: 'Este mes',
  todo: 'Desde siempre',
  rango: 'Personalizado',
};

// Contra la LISTA y no con `valor in ETIQUETA_PERIODO`: `in` también es verdadero para 'toString' y
// el resto de las claves del prototipo, que llegarían por querystring como un período "válido".
export function esPeriodo(valor: string | undefined): valor is Periodo {
  return (PERIODOS as readonly string[]).includes(valor ?? '');
}

// Un período ya resuelto a fechas. `hasta` nunca es null: la app SIEMPRE lo manda (reporte_por_dia lo
// exige, spec §5.2), así que "Desde siempre" y un rango sin hasta terminan hoy. `desde` null = sin
// borde inferior.
export interface RangoResuelto {
  desde: string | null;
  hasta: string;
}

// Resuelve un período a fechas en la zona del comercio. `crudo` son el desde/hasta de la URL: solo
// cuentan con `rango` (un preset los ignora).
export function resolverPeriodo(
  periodo: Periodo,
  crudo: { desde?: string; hasta?: string },
  ahora: Date,
  zonaHoraria: string,
): RangoResuelto {
  const hoy = hoyEnZona(zonaHoraria, ahora);
  switch (periodo) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'ayer': {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case '7d':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case '30d':
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case 'mes':
      return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
    case 'todo':
      return { desde: null, hasta: hoy };
    case 'rango': {
      // Sin hasta (o ilegible) = hoy, y RECIÉN DESPUÉS se da vuelta si quedó invertido: un desde en el
      // futuro sin hasta es un rango al revés contra hoy, no un rango vacío.
      const { desde, hasta } = resolverRangoFechas(crudo.desde, limpiarFecha(crudo.hasta) ?? hoy);
      // TECHO: ninguna fecha pasa de hoy, igual que el piso de 2000 ataja las absurdas por abajo.
      // reporte_por_dia genera la serie día por día hasta p_hasta: con `?periodo=rango&hasta=9999-12-31`
      // escrito a mano serían unos 2,9 millones de filas por consulta, y el Excel las pediría de a 1000.
      // Se aplica DESPUÉS de dar vuelta el rango, así que desde <= hasta se conserva (el techo es
      // monótono): un rango entero en el futuro queda en "hoy", no invertido.
      const techo = (fecha: string) => (fecha > hoy ? hoy : fecha);
      return { desde: desde === null ? null : techo(desde), hasta: techo(hasta ?? hoy) };
    }
  }
}
