import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { guardarBranding } from '../comercio/guardarBranding';

// La función de la base `emitir_tarjeta` (migración 0043), llamada DIRECTAMENTE, sin pasar por
// registrarCliente: sus ramas SQL, una por caso.
//
//   A. el programa es de sellos y regala 2   → la tarjeta nace en 2 y el libro tiene UNA fila 'regalo'.
//   B. el programa FUE de sellos con regalo 2 y ya es de otro tipo (el FM le cambió el tipo)
//                                            → la tarjeta nace en 0, sin fila.
//   C. el programa regala 0                  → la tarjeta nace en 0, sin fila.
//   D. la tarjeta ya existía                 → lanza 23505 y no deja NADA suelto.
//   E. el programa es de OTRO comercio       → no se lee su regalo: la tarjeta nace en 0, sin fila.
//
// Por qué un archivo aparte de sellosRegalo.integracion.test.ts: aquello prueba el recorrido del
// dueño (registrarCliente, historial, pase). Esto prueba la función, y existe para poder MUTARLA: el
// nombre de la función sale de EMITIR_TARJETA_FUNCION (por defecto, la real), así la misma prueba
// corre contra una copia rota de ella sin tocar la verdadera. La función real NO se rompe nunca en la
// base compartida: dañarla un minuto es dejar sin registro a todos los comercios.
//
// Necesita la 0043 aplicada.
//
// ══ MUTACIONES PENDIENTES (SQL) — NO CORRIDAS todavía ══
// Cada mutante es una copia EXACTA de emitir_tarjeta con UNA línea rota, creada con otro nombre. El
// SQL lo corre el dueño en Studio (el asistente no puede correr DDL):
//
//   - supabase/pruebas/mutantes-0043.sql        crea los cuatro
//   - supabase/pruebas/mutantes-0043-borrar.sql  los borra
//
// Viven en `supabase/pruebas/` y NO en `supabase/migrations/`: no son migraciones (no se aplican al
// desplegar ni dejan nada en la base), son herramienta de prueba. Y viven en el repo porque el
// workspace de la sesión (`.superpowers/`) está en el `.gitignore` y se borra al cerrarla: sin esta
// copia los mutantes serían imposibles de volver a correr.
//
// Después, uno por uno (con el mutante creado, y antes de borrarlos):
//
//   EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_a npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
//   EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_b npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
//   EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_c npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
//   EMITIR_TARJETA_FUNCION=emitir_tarjeta_mut_d npx vitest run lib/tarjetas/emitirTarjeta.sql.test.ts
//
//   mut_a  quita la condición `p.tipo_tarjeta = 'sellos'` (lee siempre p.sellos_regalo).
//          Tiene que fallar el caso B, en "sellos_regalados que devuelve la función", con
//          `expected 2 to be +0`.
//   mut_b  inserta la tarjeta con saldo 0 en vez de v_regalo.
//          Tiene que fallar el caso A: "la tarjeta nace con el saldo del regalo" con `expected 0 to be 2`.
//   mut_c  se salta el insert del movimiento en el ledger.
//          Tiene que fallar el caso A: "el libro tiene UNA fila" (`expected [] to deeply equal
//          [ { tipo: 'regalo', … } ]`).
//   mut_d  quita `and p.comercio_id = p_comercio_id` de la lectura del regalo (lee el programa sea de
//          quien sea).
//          Tiene que fallar el caso E: "sellos_regalados: el regalo de un programa ajeno no se lee"
//          con `expected 2 to be +0` (y detrás, la tarjeta en 2 y una fila de regalo). A, B, C y D pasan.
//
// Hasta que el dueño las corra, estas cuatro NO están confirmadas: la defensa de la función son los
// casos 1, 2 y 5 de sellosRegalo.integracion.test.ts, que fallaban antes de que la función existiera
// (el guard de comercio de mut_d no lo ejerce ninguno de ellos: solo el caso E).
const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

// Qué función se llama. La real salvo que se pida un mutante.
const FUNCION = process.env.EMITIR_TARJETA_FUNCION ?? 'emitir_tarjeta';

// Los clientes que crea ESTE archivo y que pueden quedar SIN tarjeta (si un mutante rompe la función
// antes de insertarla): el fixture solo borra clientes que cuelgan de una tarjeta de sus comercios.
const clientesSueltos: string[] = [];

afterEach(async () => {
  await entorno.limpiar();
  if (clientesSueltos.length) {
    await supabase.from('clientes').delete().in('id', clientesSueltos);
    clientesSueltos.length = 0;
  }
});

const MARCA_BASE = {
  color_fondo: 'rgb(10, 20, 30)',
  color_texto: 'rgb(255, 255, 255)',
  color_label: 'rgb(255, 255, 255)',
  difuminado_franja: 'medio',
  nombre_pase: null,
  encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
  oscurecer_franja: true,
};

// Un comercio de sellos con la meta y el regalo cargados por el camino de producción (guardarBranding,
// modo negocio), con las columnas legadas del comercio vacías.
async function programaConRegalo(
  selloMeta: number | null,
  sellosRegalo: number,
): Promise<{ comercioId: string; programaId: string }> {
  const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
  const res = await guardarBranding(supabase, comercioId, {
    ...MARCA_BASE,
    sello_meta: selloMeta,
    sellos_regalo: sellosRegalo,
  });
  if (!res.ok) throw new Error(`no se pudo cargar el regalo de prueba: ${res.error}`);
  return { comercioId, programaId: entorno.obtenerProgramaPrincipal(comercioId) };
}

async function crearClienteSinTarjeta(): Promise<string> {
  const telefono = `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
  const { data, error } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Sin Tarjeta', telefono })
    .select('id')
    .single();
  if (error) throw error;
  clientesSueltos.push(data.id);
  return data.id;
}

// La llamada, con el nombre de función elegido por el entorno. El cast es el único lugar donde se
// pierde el tipo: los tipos generados solo conocen 'emitir_tarjeta', y los mutantes comparten su
// firma exacta.
async function emitir(comercioId: string, programaId: string, clienteId: string) {
  return supabase.rpc(FUNCION as 'emitir_tarjeta', {
    p_comercio_id: comercioId,
    p_programa_id: programaId,
    p_cliente_id: clienteId,
    p_vigencia_hasta: null,
  });
}

async function leerTarjeta(tarjetaId: string) {
  const { data, error } = await supabase
    .from('tarjetas')
    .select('puntos_actuales, qr_token')
    .eq('id', tarjetaId)
    .single();
  if (error) throw error;
  return data;
}

async function libroDe(tarjetaId: string) {
  const { data, error } = await supabase
    .from('transacciones_puntos')
    .select('tipo, puntos_delta, cajero_usuario_id, sucursal_id, motivo, forzado')
    .eq('tarjeta_id', tarjetaId);
  if (error) throw error;
  return data;
}

// Borra una tarjeta que la función creó con un par comercio/programa que NO es el del fixture (caso
// E): lleva el comercio A pero cuelga del programa de B. El fixture la encuentra por comercio_id, pero
// si el orden de su limpieza cambiara, borrar el programa de B antes que esta tarjeta fallaría con
// 23503 en SILENCIO y dejaría basura en la base real. Por eso se borra acá, explícita y primero: el
// ledger antes que la tarjeta (transacciones_puntos.tarjeta_id la referencia).
async function borrarTarjeta(tarjetaId: string) {
  const { error: errorLibro } = await supabase.from('transacciones_puntos').delete().eq('tarjeta_id', tarjetaId);
  if (errorLibro) console.error('[test] no se pudo borrar el libro de la tarjeta suelta:', errorLibro);
  const { error: errorTarjeta } = await supabase.from('tarjetas').delete().eq('id', tarjetaId);
  if (errorTarjeta) console.error('[test] no se pudo borrar la tarjeta suelta:', errorTarjeta);
}

describe(`emitir_tarjeta (función: ${FUNCION})`, () => {
  it('A. programa de sellos con regalo 2: la tarjeta nace con 2 y el libro tiene UNA fila de regalo', async () => {
    const { comercioId, programaId } = await programaConRegalo(10, 2);
    const clienteId = await crearClienteSinTarjeta();

    const { data, error } = await emitir(comercioId, programaId, clienteId);

    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(1);
    const fila = data![0];
    expect(fila.sellos_regalados, 'sellos_regalados que devuelve la función').toBe(2);
    const tarjeta = await leerTarjeta(fila.id_tarjeta);
    expect(tarjeta.puntos_actuales, 'la tarjeta nace con el saldo del regalo').toBe(2);
    expect(tarjeta.qr_token, 'token_qr es el de la tarjeta').toBe(fila.token_qr);
    // UNA fila, del programa y no de quien atendió: sin cajero ni sucursal ni motivo, no forzada.
    expect(await libroDe(fila.id_tarjeta), 'el libro tiene UNA fila de regalo').toEqual([
      { tipo: 'regalo', puntos_delta: 2, cajero_usuario_id: null, sucursal_id: null, motivo: null, forzado: false },
    ]);
  });

  it('B. un programa que FUE de sellos con regalo 2 y ya es de otro tipo: la tarjeta nace en 0 y sin fila', async () => {
    const { comercioId, programaId } = await programaConRegalo(10, 2);
    // `update` directo del tipo: es el estado que deja propagarTipoAlProgramaPrincipal cuando FM le
    // cambia el tipo al comercio, y que ni guardarBranding ni la pantalla de Marca pueden fabricar
    // (esconde el campo fuera de sellos). La columna sigue en 2; la función no la puede aplicar a
    // una tarjeta de puntos.
    const { error: errorTipo } = await supabase
      .from('programas_tarjeta')
      .update({ tipo_tarjeta: 'puntos' })
      .eq('id', programaId);
    if (errorTipo) throw errorTipo;
    const { data: programa } = await supabase
      .from('programas_tarjeta')
      .select('tipo_tarjeta, sellos_regalo')
      .eq('id', programaId)
      .single();
    expect(programa, 'el estado de partida: regalo 2 guardado en un programa de puntos').toEqual({
      tipo_tarjeta: 'puntos',
      sellos_regalo: 2,
    });
    const clienteId = await crearClienteSinTarjeta();

    const { data, error } = await emitir(comercioId, programaId, clienteId);

    expect(error, error?.message).toBeNull();
    const fila = data![0];
    expect(fila.sellos_regalados, 'sellos_regalados que devuelve la función').toBe(0);
    expect((await leerTarjeta(fila.id_tarjeta)).puntos_actuales).toBe(0);
    expect(await libroDe(fila.id_tarjeta)).toEqual([]);
  });

  it('C. programa con regalo 0: la tarjeta nace en 0 y sin fila', async () => {
    const { comercioId, programaId } = await programaConRegalo(10, 0);
    const clienteId = await crearClienteSinTarjeta();

    const { data, error } = await emitir(comercioId, programaId, clienteId);

    expect(error, error?.message).toBeNull();
    const fila = data![0];
    expect(fila.sellos_regalados).toBe(0);
    expect((await leerTarjeta(fila.id_tarjeta)).puntos_actuales).toBe(0);
    expect(await libroDe(fila.id_tarjeta), 'ni una fila con delta 0').toEqual([]);
  });

  it('D. si la tarjeta ya existe: lanza 23505 y no deja ningún regalo suelto', async () => {
    const { comercioId, programaId } = await programaConRegalo(10, 2);
    const clienteId = await crearClienteSinTarjeta();
    const primera = await emitir(comercioId, programaId, clienteId);
    expect(primera.error, primera.error?.message).toBeNull();
    const tarjetaId = primera.data![0].id_tarjeta;

    const segunda = await emitir(comercioId, programaId, clienteId);

    // PostgREST devuelve el SQLSTATE en `code`: es lo que lee la recuperación de carreras de
    // registrarCliente. Y la transacción entera se cae: la tarjeta sigue en 2 y el libro en UNA fila.
    expect(segunda.error?.code).toBe('23505');
    expect(segunda.data).toBeNull();
    expect((await leerTarjeta(tarjetaId)).puntos_actuales).toBe(2);
    expect(await libroDe(tarjetaId)).toHaveLength(1);
  });

  it('E. un programa de OTRO comercio: la función no lee su regalo y la tarjeta nace en 0 y sin fila', async () => {
    // El comercio A es el que llama y no regala nada, para que ningún 2 pueda venir de él.
    const { comercioId: comercioA } = await programaConRegalo(10, 0);
    // El comercio B es el dueño del programa: meta 10 y regalo 2, cargados por el camino de producción.
    const { comercioId: comercioB, programaId: programaB } = await programaConRegalo(10, 2);
    const { data: programa } = await supabase
      .from('programas_tarjeta')
      .select('comercio_id, tipo_tarjeta, sellos_regalo')
      .eq('id', programaB)
      .single();
    expect(programa, 'el estado de partida: un programa de sellos con regalo 2, de OTRO comercio que el que llama').toEqual({
      comercio_id: comercioB,
      tipo_tarjeta: 'sellos',
      sellos_regalo: 2,
    });
    expect(comercioB).not.toBe(comercioA);
    const clienteId = await crearClienteSinTarjeta();

    // El par desparejado: ninguna FK ata tarjetas.comercio_id a programas_tarjeta.comercio_id, así que
    // la tarjeta SÍ se crea (comercio A, programa de B). Lo que no puede pasar es que regale el 2 de B.
    let tarjetaId: string | undefined;
    try {
      const { data, error } = await emitir(comercioA, programaB, clienteId);
      tarjetaId = data?.[0]?.id_tarjeta; // antes de cualquier expect: el finally la borra aunque algo falle

      expect(error, error?.message).toBeNull();
      expect(data).toHaveLength(1);
      const fila = data![0];
      expect(fila.sellos_regalados, 'sellos_regalados: el regalo de un programa ajeno no se lee').toBe(0);
      expect(
        (await leerTarjeta(fila.id_tarjeta)).puntos_actuales,
        'la tarjeta nace en 0, sin el regalo del otro comercio',
      ).toBe(0);
      expect(await libroDe(fila.id_tarjeta), 'ni una fila de regalo en el libro').toEqual([]);
    } finally {
      if (tarjetaId) await borrarTarjeta(tarjetaId);
    }
  });
});
