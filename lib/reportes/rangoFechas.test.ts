import { describe, it, expect, afterEach } from 'vitest';
import {
  esFechaValida,
  resolverRangoFechas,
  rangoUltimosDias,
  completarRango,
  resolverPeriodo,
  esPeriodo,
  FECHA_MINIMA,
  PERIODOS,
  PERIODO_POR_DEFECTO,
} from './rangoFechas';
// Los dos ladrillos de calendario son los de vigencia.ts (este módulo los importa, no los copia). Se
// prueban acá también porque de ellos depende que los presets no se corran de día: vigencia.ts no
// tenía prueba pura de hoyEnZona con la zona del PROCESO forzada.
import { hoyEnZona, sumarDias } from '@/lib/tarjetas/vigencia';

// Módulo puro: sin BD, sin reloj propio. Todo lo que depende del tiempo entra por argumento.
//
// ZONAS: la PC de Daniel está en UTC−6, igual que America/El_Salvador; Vercel corre en UTC. Con El
// Salvador sola, un código que use el reloj del PROCESO pasa acá y falla en producción. Por eso los
// presets se prueban en America/Bogota (UTC−5) y Europe/Madrid (con horario de verano), y los casos
// de medianoche corren además con la zona del proceso FORZADA a otras tres (mismo mecanismo que
// lib/tarjetas/formatearFecha.test.ts, con el chequeo de que el cambio tomó).
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer; las de 24 h y la del
// reloj del proceso, vueltas a correr tras pasar a hoyEnZona/sumarDias de vigencia.ts):
// - Restar 24 h en vez de calendario, en rangoUltimosDias (lo que hacía antes: `desde:
//   hoyEnZona(zonaHoraria, new Date(ahora.getTime() - (cuantos - 1) * 86_400_000))`). Caen "Europe/
//   Madrid, día del atraso de hora" con `expected { desde: '2026-10-20', …(1) } to deeply equal
//   { desde: '2026-10-19', …(1) }` y "Europe/Madrid, día del adelanto de hora" con `expected { desde:
//   '2026-03-28', …(1) } to deeply equal { desde: '2026-03-29', …(1) }`. (Son las mismas dos que
//   cayeron en rojo contra el código viejo, antes de reescribirlo.)
// - Lo mismo en CADA preset de resolverPeriodo que retrocede días; cae siempre "Europe/Madrid el día
//   del atraso de hora: ayer, 7d, 30d y mes por calendario":
//   · '7d' (`ahora.getTime() - 6 * 86_400_000`): `expected { desde: '2026-10-20', …(1) } to deeply
//     equal { desde: '2026-10-19', …(1) }`;
//   · 'ayer' (`- 86_400_000`): `expected { desde: '2026-10-25', …(1) } to deeply equal { desde:
//     '2026-10-24', …(1) }`;
//   · '30d', el que se ve por defecto (`- 29 * 86_400_000`): `expected { desde: '2026-09-27', …(1) }
//     to deeply equal { desde: '2026-09-26', …(1) }`. Antes de sumarle su caso a esa prueba, esta
//     mutación quedaba VERDE (lo encontró la revisión);
//   · 'mes' (retroceder `(día − 1) * 86_400_000` en vez de tomar el 1 del texto): `expected { desde:
//     '2026-10-02', …(1) } to deeply equal { desde: '2026-10-01', …(1) }`.
// - completarRango sin su guarda (lo que hacía la pantalla de cajeros: completar sin mirar el orden):
//   caen tres, entre ellas "el caso de 1999…" con `expected '2026-08-25' to be null`. Dando vuelta en
//   vez de soltar el borde del default: caen "el caso de 1999…" con `expected '2026-01-15' to be null`
//   y "desde pedido DESPUÉS del default de hasta…" con `expected { desde: '2026-09-23', …(1) } to
//   deeply equal { desde: '2026-12-01', hasta: null }`.
// - Sin el piso (`&& texto >= FECHA_MINIMA` borrado de limpiarFecha): caen "no acepta fechas
//   anteriores a 2000-01-01" con `expected { desde: '1999-12-31', …(1) } to deeply equal { desde:
//   null, hasta: '2026-07-28' }` y "fechas antes del piso: 0001-01-01 y 1999-12-31…" con `expected
//   { desde: '0001-01-01', …(1) } to deeply equal { desde: null, hasta: '2026-09-23' }`.
// - Sin el techo (`techo = (fecha) => fecha`): caen "techo: ninguna fecha pasa de HOY…" con
//   `expected '9999-12-31' to be '2026-09-23'` y "un rango entero en el futuro queda en hoy…" con
//   `expected '2026-12-01' to be '2026-09-23'`. Con el techo solo en `hasta` (desde sin techo): cae
//   "un rango entero en el futuro…" con `expected { desde: '2026-12-01', …(1) } to deeply equal
//   { desde: '2026-09-23', …(1) }` (quedaría invertido).
// - hoyEnZona (lib/tarjetas/vigencia.ts, mutada ahí y restaurada) con el reloj del PROCESO
//   (`${ahora.getFullYear()}-…getMonth()…getDate()` en vez de Intl): caen 11, entre ellas "hoyEnZona
//   da el día en la zona pedida…" con `UTC: expected '2026-09-23' to be '2026-09-22'` y "hoy y ayer
//   cerca de la medianoche de Bogotá" con `America/El_Salvador: expected { desde: '2026-09-22', …(1) }
//   to deeply equal { desde: '2026-09-23', …(1) }`.
// - esPeriodo con `valor in ETIQUETA_PERIODO` en vez de la lista: cae "el catálogo y el default" con
//   `'toString' no es un período: expected true to be false`.

const tzOriginal = process.env.TZ;
const zonaOriginal = Intl.DateTimeFormat().resolvedOptions().timeZone;

function zonaDelProceso(zona: string) {
  process.env.TZ = zona;
  // Si el runner dejara de respetar el cambio, la prueba se cae acá en vez de quedar verde en UTC.
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zona);
}

afterEach(() => {
  // `delete process.env.TZ` no le avisa a Node: primero se reasigna la zona original.
  process.env.TZ = zonaOriginal;
  if (tzOriginal === undefined) delete process.env.TZ;
});

// Zonas de proceso donde se corren los casos de medianoche: la de producción, la de Daniel y una del
// otro lado del mundo (UTC+9), que corre el día en la dirección contraria.
const ZONAS_DE_PROCESO = ['UTC', 'America/El_Salvador', 'Asia/Tokyo'];

describe('esFechaValida', () => {
  it('acepta una fecha real en formato AAAA-MM-DD', () => {
    expect(esFechaValida('2026-07-28')).toBe(true);
    expect(esFechaValida('2024-02-29')).toBe(true); // bisiesto real
  });

  it('rechaza fechas que el calendario no tiene', () => {
    // El round-trip por Date es lo que atrapa esto: `new Date('2026-02-31')` no falla, JS lo
    // "corrige" a marzo en silencio. Sin el round-trip, un filtro imposible pasaría al RPC.
    expect(esFechaValida('2026-02-31')).toBe(false);
    expect(esFechaValida('2026-13-01')).toBe(false);
    expect(esFechaValida('2025-02-29')).toBe(false); // 2025 no es bisiesto
  });

  it('rechaza formatos que no son AAAA-MM-DD', () => {
    // El mensaje nombra el valor: sin él, un fallo dice "expected true to be false" y hay que
    // adivinar cuál de los seis lo causó (pasó al escribir esta prueba, con '0000-01-01').
    for (const valor of ['', '28/07/2026', '2026-7-28', '2026-07-28T10:00:00', 'ayer', '0000-01-01']) {
      expect(esFechaValida(valor), `"${valor}" debería rechazarse`).toBe(false);
    }
  });
});

describe('resolverRangoFechas', () => {
  it('deja pasar un rango válido tal cual', () => {
    expect(resolverRangoFechas('2026-07-01', '2026-07-28')).toEqual({
      desde: '2026-07-01',
      hasta: '2026-07-28',
    });
  });

  it('descarta una fecha ilegible en vez de rechazar la pantalla entera', () => {
    // Un filtro mal tecleado no debería dejar al dueño sin poder ver nada: se cae ese borde y el
    // otro sigue aplicando.
    expect(resolverRangoFechas('no-es-fecha', '2026-07-28')).toEqual({
      desde: null,
      hasta: '2026-07-28',
    });
  });

  it('trata undefined y vacío como "sin ese borde"', () => {
    expect(resolverRangoFechas(undefined, undefined)).toEqual({ desde: null, hasta: null });
    expect(resolverRangoFechas('  ', '')).toEqual({ desde: null, hasta: null });
  });

  it('intercambia un rango invertido en vez de vaciarlo', () => {
    // Es casi siempre un error de tecleo. Devolver el rango que el dueño evidentemente quiso ver
    // es mejor que devolverle una tabla vacía sin explicación.
    expect(resolverRangoFechas('2026-07-28', '2026-07-01')).toEqual({
      desde: '2026-07-01',
      hasta: '2026-07-28',
    });
  });

  it('no intercambia cuando desde y hasta son el mismo día', () => {
    // El borde del `>`: con `>=` un rango de un solo día seguiría funcionando, pero conviene que
    // quede fijado que un solo día es legítimo (ver la actividad de hoy).
    expect(resolverRangoFechas('2026-07-28', '2026-07-28')).toEqual({
      desde: '2026-07-28',
      hasta: '2026-07-28',
    });
  });

  it('no acepta fechas anteriores a 2000-01-01 (el piso), pero sí el piso mismo', () => {
    // Una fecha así es un disparate en cualquier pantalla de reportes (el sistema nació en 2026), y
    // del lado de Excel, antes de 1900 ni siquiera hay número de serie.
    expect(FECHA_MINIMA).toBe('2000-01-01');
    expect(resolverRangoFechas('1999-12-31', '2026-07-28')).toEqual({ desde: null, hasta: '2026-07-28' });
    expect(resolverRangoFechas('0001-01-01', '0001-01-02')).toEqual({ desde: null, hasta: null });
    expect(resolverRangoFechas('2000-01-01', '2026-07-28')).toEqual({
      desde: '2000-01-01',
      hasta: '2026-07-28',
    });
  });
});

describe('hoyEnZona y sumarDias (de vigencia.ts)', () => {
  it('hoyEnZona da el día en la zona pedida, no en la del proceso', () => {
    // 05:30 UTC: en Bogotá (UTC−5) ya es el 23 a las 00:30; en El Salvador (UTC−6) todavía el 22.
    const instante = new Date('2026-09-23T05:30:00Z');
    for (const zona of ZONAS_DE_PROCESO) {
      zonaDelProceso(zona);
      expect(hoyEnZona('America/Bogota', instante), zona).toBe('2026-09-23');
      expect(hoyEnZona('America/El_Salvador', instante), zona).toBe('2026-09-22');
      // Mes y día de una cifra, con su cero: el formato es el que comparan los presets como texto.
      expect(hoyEnZona('Europe/Madrid', new Date('2026-03-05T12:00:00Z')), zona).toBe('2026-03-05');
    }
  });

  it('sumarDias es aritmética de calendario: meses, años y bisiestos', () => {
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2024-03-01', -1)).toBe('2024-02-29');
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31');
    expect(sumarDias('2026-09-23', -29)).toBe('2026-08-25');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-09-23', 0)).toBe('2026-09-23');
  });
});

describe('rangoUltimosDias', () => {
  it('cuenta HOY como uno de los días', () => {
    // 30 días termina hoy y empieza 29 días atrás, no 30: si contara 30 hacia atrás, el rango
    // tendría 31 días y no coincidiría con lo que dice la pantalla.
    const hoy = new Date('2026-07-28T18:00:00Z');
    expect(rangoUltimosDias(hoy, 30, 'America/El_Salvador')).toEqual({
      desde: '2026-06-29',
      hasta: '2026-07-28',
    });
  });

  it('un rango de un día es solo hoy', () => {
    const hoy = new Date('2026-07-28T18:00:00Z');
    expect(rangoUltimosDias(hoy, 1, 'America/El_Salvador')).toEqual({
      desde: '2026-07-28',
      hasta: '2026-07-28',
    });
  });

  it('usa la zona del comercio, no la del servidor', () => {
    // 2026-07-28 a las 03:00 UTC es todavía el 27 en El Salvador (UTC-6). Un servidor en UTC
    // —Vercel— diría 28 y el reporte arrancaría un día corrido. Esta es exactamente la clase de
    // error que en una pantalla de auditoría hace desaparecer movimientos.
    const madrugadaUtc = new Date('2026-07-28T03:00:00Z');
    expect(rangoUltimosDias(madrugadaUtc, 1, 'America/El_Salvador')).toEqual({
      desde: '2026-07-27',
      hasta: '2026-07-27',
    });
    expect(rangoUltimosDias(madrugadaUtc, 1, 'UTC')).toEqual({
      desde: '2026-07-28',
      hasta: '2026-07-28',
    });
  });

  it('satura un número de días absurdo en 1', () => {
    const hoy = new Date('2026-07-28T18:00:00Z');
    expect(rangoUltimosDias(hoy, 0, 'America/El_Salvador').desde).toBe('2026-07-28');
    expect(rangoUltimosDias(hoy, -5, 'America/El_Salvador').desde).toBe('2026-07-28');
  });

  // El caso por el que se reescribió con calendario. El 25 de octubre de 2026 Madrid atrasa la hora
  // (CEST → CET) y ese día dura 25 horas. A las 23:30 de ese día, restar 6 × 24 h cae a las 00:30
  // del día 20 y no del 19: "7 días" pierde un día entero. La pantalla de cajeros lo usaba así.
  it('Europe/Madrid, día del atraso de hora: 7 días son 7 fechas de calendario', () => {
    const ahora = new Date('2026-10-25T22:30:00Z'); // 23:30 CET del 25
    expect(rangoUltimosDias(ahora, 7, 'Europe/Madrid')).toEqual({ desde: '2026-10-19', hasta: '2026-10-25' });
  });

  // Y el simétrico: el 29 de marzo de 2026 Madrid adelanta la hora y ese día dura 23 horas. A las
  // 00:30 del 30, restar 24 h cae a las 23:30 del 28: "ayer" sería anteayer.
  it('Europe/Madrid, día del adelanto de hora: 2 días empiezan ayer', () => {
    const ahora = new Date('2026-03-29T22:30:00Z'); // 00:30 CEST del 30
    expect(rangoUltimosDias(ahora, 2, 'Europe/Madrid')).toEqual({ desde: '2026-03-29', hasta: '2026-03-30' });
  });
});

// La pantalla de cajeros completa lo que falte del rango pedido con su default (los últimos 30 días).
// El caso real que la rompió: `?desde=1999-06-01&hasta=2026-01-15`. Con el piso de 2000, el desde cae
// como si no estuviera, se completa con el default (hace 30 días) y queda DESPUÉS del hasta: la
// consulta devolvía vacío. Antes del piso ese enlace andaba (1999 era, en la práctica, "sin borde").
describe('completarRango', () => {
  const porDefecto = { desde: '2026-08-25', hasta: '2026-09-23' };

  it('sin nada pedido: el default', () => {
    expect(completarRango({ desde: null, hasta: null }, porDefecto)).toEqual(porDefecto);
  });

  it('con los dos bordes pedidos: esos', () => {
    expect(completarRango({ desde: '2026-01-01', hasta: '2026-01-15' }, porDefecto)).toEqual({
      desde: '2026-01-01',
      hasta: '2026-01-15',
    });
  });

  it('un borde pedido que no choca con el default del otro: se completa', () => {
    expect(completarRango({ desde: null, hasta: '2026-09-01' }, porDefecto)).toEqual({
      desde: '2026-08-25',
      hasta: '2026-09-01',
    });
    expect(completarRango({ desde: '2026-09-01', hasta: null }, porDefecto)).toEqual({
      desde: '2026-09-01',
      hasta: '2026-09-23',
    });
  });

  it('el caso de 1999: hasta pedido ANTES del default de desde → sin borde inferior, nunca invertido', () => {
    const rango = completarRango(resolverRangoFechas('1999-06-01', '2026-01-15'), porDefecto);
    expect(rango.desde).toBeNull();
    expect(rango).toEqual({ desde: null, hasta: '2026-01-15' });
  });

  it('desde pedido DESPUÉS del default de hasta → sin borde superior, nunca invertido', () => {
    expect(completarRango({ desde: '2026-12-01', hasta: null }, porDefecto)).toEqual({
      desde: '2026-12-01',
      hasta: null,
    });
  });

  it('dos bordes pedidos al revés (si alguien no pasó por resolverRangoFechas): se dan vuelta', () => {
    expect(completarRango({ desde: '2026-01-15', hasta: '2026-01-01' }, porDefecto)).toEqual({
      desde: '2026-01-01',
      hasta: '2026-01-15',
    });
  });
});

describe('períodos', () => {
  it('el catálogo y el default (confirmados por Daniel el 2026-09-23)', () => {
    expect([...PERIODOS]).toEqual(['hoy', 'ayer', '7d', '30d', 'mes', 'todo', 'rango']);
    expect(PERIODO_POR_DEFECTO).toBe('30d');
    expect(esPeriodo('7d')).toBe(true);
    expect(esPeriodo('semana')).toBe(false);
    expect(esPeriodo(undefined)).toBe(false);
    // Una clave del prototipo no es un período: el chequeo es contra la lista, no con `in`.
    expect(esPeriodo('toString'), "'toString' no es un período").toBe(false);
  });
});

describe('resolverPeriodo', () => {
  // 05:30 UTC del 23: en Bogotá son las 00:30 del 23 (recién empezó el día); en El Salvador, las
  // 23:30 del 22. Un preset que usara el reloj del proceso se corre un día en alguna de las tres
  // zonas de proceso.
  const recienEmpezado = new Date('2026-09-23T05:30:00Z');

  it('hoy y ayer cerca de la medianoche de Bogotá', () => {
    for (const zona of ZONAS_DE_PROCESO) {
      zonaDelProceso(zona);
      expect(resolverPeriodo('hoy', {}, recienEmpezado, 'America/Bogota'), zona).toEqual({
        desde: '2026-09-23',
        hasta: '2026-09-23',
      });
      expect(resolverPeriodo('ayer', {}, recienEmpezado, 'America/Bogota'), zona).toEqual({
        desde: '2026-09-22',
        hasta: '2026-09-22',
      });
    }
  });

  it('7d y 30d cuentan hoy; mes va del 1 a hoy; todo no tiene desde', () => {
    const ahora = recienEmpezado;
    const zona = 'America/Bogota';
    expect(resolverPeriodo('7d', {}, ahora, zona)).toEqual({ desde: '2026-09-17', hasta: '2026-09-23' });
    expect(resolverPeriodo('30d', {}, ahora, zona)).toEqual({ desde: '2026-08-25', hasta: '2026-09-23' });
    expect(resolverPeriodo('mes', {}, ahora, zona)).toEqual({ desde: '2026-09-01', hasta: '2026-09-23' });
    expect(resolverPeriodo('todo', {}, ahora, zona)).toEqual({ desde: null, hasta: '2026-09-23' });
  });

  it('mes el día 1, en la primera media hora: es solo ese día (no el mes anterior)', () => {
    // 00:20 del 1 de octubre en Madrid = 22:20 UTC del 30 de septiembre.
    const ahora = new Date('2026-09-30T22:20:00Z');
    expect(resolverPeriodo('mes', {}, ahora, 'Europe/Madrid')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-01',
    });
  });

  // Cada preset que retrocede días tiene su caso, uno por uno: una prueba por preset es lo que hace
  // falta para que la mutación "restar 24 h" caiga en CUALQUIERA de ellos, no solo en el que se probó.
  it('Europe/Madrid el día del atraso de hora: ayer, 7d, 30d y mes por calendario', () => {
    const ahora = new Date('2026-10-25T22:30:00Z'); // 23:30 CET del 25 (día de 25 horas)
    expect(resolverPeriodo('ayer', {}, ahora, 'Europe/Madrid')).toEqual({
      desde: '2026-10-24',
      hasta: '2026-10-24',
    });
    expect(resolverPeriodo('7d', {}, ahora, 'Europe/Madrid')).toEqual({
      desde: '2026-10-19',
      hasta: '2026-10-25',
    });
    // El que se ve por defecto. Restando 29 × 24 h daría el 27 de septiembre.
    expect(resolverPeriodo('30d', {}, ahora, 'Europe/Madrid')).toEqual({
      desde: '2026-09-26',
      hasta: '2026-10-25',
    });
    // Retrocediendo (día − 1) × 24 h en vez de tomar el 1 del texto, daría el 2 de octubre.
    expect(resolverPeriodo('mes', {}, ahora, 'Europe/Madrid')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-25',
    });
  });

  it('un preset ignora desde y hasta de la URL', () => {
    expect(
      resolverPeriodo('7d', { desde: '2026-01-01', hasta: '2026-01-31' }, recienEmpezado, 'America/Bogota'),
    ).toEqual({ desde: '2026-09-17', hasta: '2026-09-23' });
  });

  describe('rango', () => {
    const ahora = recienEmpezado;
    const zona = 'America/Bogota';

    it('toma desde y hasta de la URL', () => {
      expect(resolverPeriodo('rango', { desde: '2026-09-01', hasta: '2026-09-10' }, ahora, zona)).toEqual({
        desde: '2026-09-01',
        hasta: '2026-09-10',
      });
    });

    it('sin hasta (o ilegible) = hoy; sin desde = sin borde inferior', () => {
      expect(resolverPeriodo('rango', { desde: '2026-09-01' }, ahora, zona)).toEqual({
        desde: '2026-09-01',
        hasta: '2026-09-23',
      });
      expect(resolverPeriodo('rango', { desde: '2026-09-01', hasta: '31/09/2026' }, ahora, zona)).toEqual({
        desde: '2026-09-01',
        hasta: '2026-09-23',
      });
      expect(resolverPeriodo('rango', { hasta: '2026-09-10' }, ahora, zona)).toEqual({
        desde: null,
        hasta: '2026-09-10',
      });
      expect(resolverPeriodo('rango', {}, ahora, zona)).toEqual({ desde: null, hasta: '2026-09-23' });
    });

    it('invertido se da vuelta', () => {
      expect(resolverPeriodo('rango', { desde: '2026-09-10', hasta: '2026-09-01' }, ahora, zona)).toEqual({
        desde: '2026-09-01',
        hasta: '2026-09-10',
      });
    });

    it('techo: ninguna fecha pasa de HOY en la zona del comercio', () => {
      // A mano, `hasta=9999-12-31` haría que reporte_por_dia generara ~2,9 millones de días.
      const lejano = resolverPeriodo('rango', { desde: '2026-09-01', hasta: '9999-12-31' }, ahora, zona);
      expect(lejano.hasta).toBe('2026-09-23');
      expect(lejano).toEqual({ desde: '2026-09-01', hasta: '2026-09-23' });
      // Mañana (el 24) también es futuro: el techo es por día, no solo contra fechas absurdas.
      const manana = resolverPeriodo('rango', { desde: '2026-09-20', hasta: '2026-09-24' }, ahora, zona);
      expect(manana.hasta).toBe('2026-09-23');
      expect(manana).toEqual({ desde: '2026-09-20', hasta: '2026-09-23' });
      // Hoy mismo no se toca.
      expect(resolverPeriodo('rango', { hasta: '2026-09-23' }, ahora, zona).hasta).toBe('2026-09-23');
    });

    it('un rango entero en el futuro queda en hoy, no invertido', () => {
      // Sin hasta: se completa con hoy, se da vuelta contra él, y el techo lo deja en hoy.
      const sinHasta = resolverPeriodo('rango', { desde: '2026-12-01' }, ahora, zona);
      expect(sinHasta.hasta).toBe('2026-09-23');
      expect(sinHasta).toEqual({ desde: '2026-09-23', hasta: '2026-09-23' });
      const futuro = resolverPeriodo('rango', { desde: '2026-12-01', hasta: '2027-01-01' }, ahora, zona);
      expect(futuro).toEqual({ desde: '2026-09-23', hasta: '2026-09-23' });
    });

    it('fechas antes del piso: 0001-01-01 y 1999-12-31 caen como si no estuvieran', () => {
      expect(resolverPeriodo('rango', { desde: '0001-01-01', hasta: '1999-12-31' }, ahora, zona)).toEqual({
        desde: null,
        hasta: '2026-09-23',
      });
    });
  });
});
