// Rango de fechas de los filtros de reportes. Módulo PURO (sin BD ni JSX) para poder probar los
// bordes sin montar nada — mismo criterio que atribucionEscaner.ts y agregados.ts.
//
// Las fechas vienen de dos <input type="date"> por querystring, así que llegan como texto y pueden
// ser cualquier cosa: vacías, con formato raro, o al revés (desde > hasta). Nada de eso debe llegar
// al RPC: `reporte_cajeros` las interpreta en la zona horaria del comercio y una fecha inválida
// haría fallar el cast.

export interface RangoFechas {
  desde: string | null;
  hasta: string | null;
}

const FORMATO = /^\d{4}-\d{2}-\d{2}$/;

// Valida una fecha AAAA-MM-DD contra el calendario real: el round-trip por Date atrapa un 2026-02-31
// (que JS "corrige" a marzo) y un 0000-01-01. Mismo chequeo que validarDatosCuenta usa para
// licencia_activa_desde.
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
  const limpiar = (valor: string | undefined): string | null => {
    const texto = (valor ?? '').trim();
    return texto && esFechaValida(texto) ? texto : null;
  };

  let desde = limpiar(desdeCrudo);
  let hasta = limpiar(hastaCrudo);

  if (desde && hasta && desde > hasta) {
    [desde, hasta] = [hasta, desde];
  }

  return { desde, hasta };
}

// Rango por defecto de la pantalla: los últimos `dias` días contando hoy, en la zona del comercio.
// `hoy` se pasa como argumento (no se llama a new Date() adentro) para que la función sea pura y
// probable sin congelar el reloj.
export function rangoUltimosDias(hoy: Date, dias: number, zonaHoraria: string): RangoFechas {
  const enZona = (fecha: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zonaHoraria,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(fecha);

  const cuantos = Math.max(1, Math.floor(dias));
  const inicio = new Date(hoy.getTime() - (cuantos - 1) * 24 * 60 * 60 * 1000);
  return { desde: enZona(inicio), hasta: enZona(hoy) };
}
