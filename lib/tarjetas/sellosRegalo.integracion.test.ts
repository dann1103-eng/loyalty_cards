import { describe, it, expect, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { guardarBranding } from '../comercio/guardarBranding';
import { guardarBrandingPrograma } from '../comercio/guardarBrandingPrograma';
import { crearPrograma, obtenerPrograma } from '../comercio/programas';
import { registrarCliente } from '../clientes/registrarCliente';
import { acreditarPuntos } from '../comercio/acreditar';
import { historialTarjeta } from '../comercio/historial';
import { datosPassDeTarjeta } from '../apple/datosPassDeTarjeta';
import { generarPassApple } from '../apple/generatePass';
import { syncObjetoTarjeta } from '../google/syncObjeto';

// Google se mockea EN LA FRONTERA: lo que sale hacia su API (insert/patch del LoyaltyObject) es
// justo lo que el cliente va a leer en Android, y se mide ahí sin llamar a Google (mismo patrón que
// lib/google/syncObjeto.test.ts). Todo lo demás es la base real.
const insertMock = vi.fn();
const patchMock = vi.fn();
vi.mock('../google/walletClient', () => ({
  issuerId: () => 'issuer-test',
  walletClient: () => ({
    loyaltyobject: { insert: insertMock, patch: patchMock },
  }),
}));

// ¿Toda tarjeta NUEVA nace con su regalo, y el historial lo cuenta? (0043, Tarea 4 del plan
// docs/superpowers/plans/2026-10-28-sellos-de-regalo.md)
//
// La prueba HONESTA, al estilo de tiposFuncionales.test.ts: el comercio se deja con sus columnas
// legadas vacías (el fixture espeja al programa lo que tenga el comercio, y acá no tiene nada) y la
// meta y el regalo se cargan con guardarBranding / guardarBrandingPrograma, las MISMAS funciones que
// llama la pantalla de Marca. El registro es registrarCliente, el camino real de /api/registro.
// Nunca se escribe `sellos_regalo` con un update directo: así la prueba mide lo que vive el dueño.
// La única excepción es el caso 5, que fabrica un estado que el código no deja escribir pero la
// realidad sí produce (ver ahí).
//
// Necesita la 0043 aplicada (columna, tipo 'regalo' en el ledger y emitir_tarjeta): sin ella los
// casos fallan con "column … does not exist" o PGRST202.
//
// MUTACIONES de TypeScript, CONFIRMADAS el 2026-10-28 (cada una corrida y restaurada con
// `git checkout -- <archivo>`; el mensaje es el que imprimió vitest):
//   - registrarCliente.ts: volver al insert directo de la tarjeta (sin función, sellos_regalados en 0)
//     hace fallar 7 de 9. El 1, con "lo que devolvió emitir_tarjeta: expected +0 to be 2"; el 2, con
//     "expected [] to have a length of 1 but got +0" (sin fila de regalo no hay historial); el 3, 4, 6,
//     8 y 9, con "expected +0 to be 2". Pasan el 5 y el 7, que afirman 0.
//   - registrarCliente.ts: `sellosRegalo: 0` en la tarjeta NUEVA (en vez de lo que devolvió la
//     función) hace fallar 1, 4, 6, 8 y 9, todos con "expected +0 to be 2".
//   - registrarCliente.ts: devolver `sellosRegalo: 2` en la tarjeta ya existente hace fallar SOLO el 3
//     ("expected 2 to be +0"). Devolverlo en la ganadora de la carrera, SOLO el 9 (mismo mensaje):
//     son dos caminos distintos y cada uno tiene su prueba.
//   - registrarCliente.ts: no recuperar la ganadora ante el 23505 (lanzar siempre) hace fallar SOLO el
//     9, con `Unknown Error: duplicate key value violates unique constraint
//     "tarjetas_cliente_programa_key"`. El caso 9 existe porque la carrera de registrarCliente.test.ts
//     (dos registros en paralelo) depende del reloj; esa prueba también cayó en las dos corridas.
//   - registrarCliente.ts: `p_vigencia_hasta: null` en la llamada a la función deja al cupón sin
//     vencimiento; lo atrapa tiposFuncionales.test.ts ("cupón: la tarjeta nace con la vigencia…",
//     con `expected null not to be null`), no este archivo.
//   - registrarCliente.ts, `puntosActuales` (el saldo real que dibuja la tarjeta de muestra; confirmadas
//     2026-10-28, cada una restaurada): devolver 0 en la tarjeta NUEVA hace fallar SOLO el 1 ("el saldo
//     con el que nació, para la tarjeta de muestra: expected +0 to be 2"). Devolver 0 (el valor de
//     `sellosRegalo`) en la ruta de tarjeta ENCONTRADA hace fallar el 3 ("expected +0 to be 2") y el 10
//     ("pero su tarjeta vale 3: expected +0 to be 3"); en la ganadora de la CARRERA, el 9 ("expected +0
//     to be 2") y el 11 ("expected +0 to be 3"). No agregar `puntos_actuales` al select de cada una de
//     esas dos rutas falla los mismos casos con `expected undefined to be 2` / `to be 3`.
//   - historial.ts: sacar 'regalo' de CLASES hace fallar el 2 ("expected 'acreditacion' to be
//     'regalo'") y la prueba equivalente de historial.test.ts.
//   - contadorPase.ts: `0 de ${selloMeta}` fijo en vez de los puntos hace fallar el 6 en el lado de
//     Apple (`"value": "2 de 10"` contra `"0 de 10"`). frentePase.ts: `0 de … sellos` fijo en el
//     listado, el 6 en el de Google (`"string": "2 de 10 sellos"` contra `"0 de 10 sellos"`). Así el
//     6 mide el texto que se dibuja y no la columna.
//
// MUTACIONES PENDIENTES de SQL: ver el encabezado de emitirTarjeta.sql.test.ts, que las lleva
// contra mutantes de la función (emitir_tarjeta_mut_a/b/c) sin tocar la real. NO están corridas ni
// confirmadas: mientras tanto, la defensa de la función son los casos 1, 2 y 5 de este archivo, que
// fallaban antes de que existiera.
const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  insertMock.mockReset();
  patchMock.mockReset();
  await entorno.limpiar();
});

// Lo que el formulario de Marca manda además de la meta y el regalo. Valores que pasan la
// validación; no importan para estas pruebas.
const MARCA_BASE = {
  color_fondo: 'rgb(10, 20, 30)',
  color_texto: 'rgb(255, 255, 255)',
  color_label: 'rgb(255, 255, 255)',
  difuminado_franja: 'medio',
  nombre_pase: null,
  encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
  oscurecer_franja: true,
};

// Un comercio de sellos con la meta y el regalo cargados POR EL CAMINO DE PRODUCCIÓN (modo negocio:
// escribe al programa principal). Las columnas legadas del comercio quedan vacías.
async function comercioConRegalo(
  selloMeta: number | null,
  sellosRegalo: number,
  camposComercio: Parameters<typeof entorno.crearComercio>[0] = {},
): Promise<{ comercioId: string; programaId: string }> {
  const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos', ...camposComercio });
  const res = await guardarBranding(supabase, comercioId, {
    ...MARCA_BASE,
    sello_meta: selloMeta,
    sellos_regalo: sellosRegalo,
  });
  if (!res.ok) throw new Error(`no se pudo cargar el regalo de prueba: ${res.error}`);
  return { comercioId, programaId: entorno.obtenerProgramaPrincipal(comercioId) };
}

// El teléfono es UNIQUE global y registrarCliente exige el canónico +503…
function telefonoUnico(): string {
  return `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

async function saldoDe(tarjetaId: string): Promise<number> {
  const { data, error } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
  if (error) throw error;
  return data.puntos_actuales;
}

// El libro de la tarjeta TAL CUAL está en la tabla, con las columnas que distinguen un regalo de un
// movimiento de caja (cajero, sucursal, motivo, forzado).
async function libroDe(tarjetaId: string) {
  const { data, error } = await supabase
    .from('transacciones_puntos')
    .select('tipo, puntos_delta, cajero_usuario_id, sucursal_id, motivo, forzado, monto_compra')
    .eq('tarjeta_id', tarjetaId);
  if (error) throw error;
  return data;
}

// Un cliente que, en su PRIMERA lectura de `tarjetas`, no ve la tarjeta que ya existe: es exactamente la
// ventana de la carrera ("buscar la tarjeta" y "emitirla" no son atómicos). Todo lo demás, incluida
// la función emitir_tarjeta y la relectura de la ganadora, va a la base real. Es lo que vuelve
// determinista un caso que en registrarCliente.test.ts (dos registros en paralelo) solo ocurre cuando
// el reloj lo permite.
function clienteConLecturaCiega(real: SupabaseClient<Database>): SupabaseClient<Database> {
  let primeraLectura = true;
  return new Proxy(real, {
    get(destino, propiedad) {
      if (propiedad === 'from') {
        return (tabla: string) => {
          if (tabla === 'tarjetas' && primeraLectura) {
            primeraLectura = false;
            const ciega = {
              select: () => ciega,
              eq: () => ciega,
              maybeSingle: async () => ({ data: null, error: null }),
            };
            return ciega;
          }
          return destino.from(tabla as 'tarjetas');
        };
      }
      const valor = Reflect.get(destino, propiedad);
      return typeof valor === 'function' ? valor.bind(destino) : valor;
    },
  });
}

describe('toda tarjeta nueva nace con su regalo', () => {
  it('1. sellos con meta 10 y regalo 2: la tarjeta nace en 2 y el libro tiene UNA fila de regalo', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 2);

    const alta = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefonoUnico());

    expect(alta.esNuevaTarjeta).toBe(true);
    expect(alta.sellosRegalo, 'lo que devolvió emitir_tarjeta').toBe(2);
    expect(alta.puntosActuales, 'el saldo con el que nació, para la tarjeta de muestra').toBe(2);
    expect(await saldoDe(alta.tarjetaId), 'el saldo con el que nació la tarjeta').toBe(2);
    // El movimiento es del PROGRAMA, no de quien atendió: sin cajero ni sucursal (si llevara cajero
    // inflaría su reporte), sin motivo, y no forzado ni con monto.
    expect(await libroDe(alta.tarjetaId)).toEqual([
      {
        tipo: 'regalo',
        puntos_delta: 2,
        cajero_usuario_id: null,
        sucursal_id: null,
        motivo: null,
        forzado: false,
        monto_compra: null,
      },
    ]);
  });

  it('2. el historial la cuenta como regalo con saldo 2, y la suma corrida cuadra al acreditar', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 2);
    const alta = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefonoUnico());

    const alNacer = await historialTarjeta(supabase, comercioId, alta.tarjetaId);
    expect(alNacer).toHaveLength(1);
    // 'regalo' y no 'acreditacion': el fallback de normalizarClase colapsaría una clase que no
    // conoce, y la ficha del dueño diría "Acreditación +2" para algo que nadie compró.
    expect(alNacer![0].clase).toBe('regalo');
    expect(alNacer![0].delta).toBe(2);
    expect(alNacer![0].saldoResultante).toBe(2);
    expect(alNacer![0].cajeroEmail).toBeNull();
    expect(alNacer![0].sucursalNombre).toBeNull();

    const acreditacion = await acreditarPuntos(supabase, comercioId, alta.tarjetaId, 1);
    expect(acreditacion.ok, acreditacion.ok ? '' : acreditacion.error).toBe(true);

    // Del más reciente al más viejo. El saldo de la acreditación es 3 (2 de regalo + 1): si el
    // regalo no estuviera en el libro, la suma corrida diría 1 mientras la tarjeta vale 3.
    const despues = await historialTarjeta(supabase, comercioId, alta.tarjetaId);
    expect(despues!.map((m) => [m.clase, m.delta, m.saldoResultante])).toEqual([
      ['acreditacion', 1, 3],
      ['regalo', 2, 2],
    ]);
    expect(await saldoDe(alta.tarjetaId)).toBe(3);
  });

  it('3. volver a registrar el mismo teléfono: misma tarjeta, sin regalo nuevo y UNA sola fila', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 2);
    const telefono = telefonoUnico();
    const primero = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefono);

    const segundo = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefono);

    expect(segundo.tarjetaId).toBe(primero.tarjetaId);
    expect(segundo.esNuevaTarjeta).toBe(false);
    // 0 y no 2: el regalo se da UNA vez, cuando nace la tarjeta. Lo que ve el cliente en la pantalla
    // de "Tu tarjeta está lista" depende de este número.
    expect(segundo.sellosRegalo).toBe(0);
    // Y su saldo SIGUE siendo 2: la muestra dibuja el saldo de la tarjeta, no lo que ganó ahora.
    expect(segundo.puntosActuales).toBe(2);
    expect(await saldoDe(primero.tarjetaId)).toBe(2);
    expect(await libroDe(primero.tarjetaId)).toHaveLength(1);
  });

  it('4. una tarjeta emitida ANTES de poner el regalo conserva su saldo, y las nuevas sí lo reciben', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 0);
    const vieja = await registrarCliente(supabase, comercioId, programaId, 'Vieja', null, telefonoUnico());
    // Con saldo propio, para que "sigue igual" sea una afirmación y no un 0 que tampoco se movería.
    const acreditacion = await acreditarPuntos(supabase, comercioId, vieja.tarjetaId, 3);
    expect(acreditacion.ok, acreditacion.ok ? '' : acreditacion.error).toBe(true);

    const guardado = await guardarBranding(supabase, comercioId, { ...MARCA_BASE, sello_meta: 10, sellos_regalo: 2 });
    expect(guardado.ok, guardado.ok ? '' : guardado.error).toBe(true);

    // Guardar el regalo no toca ninguna tarjeta ya emitida: ni el saldo ni el libro.
    expect(await saldoDe(vieja.tarjetaId)).toBe(3);
    expect((await libroDe(vieja.tarjetaId)).map((f) => f.tipo)).toEqual(['acreditacion']);

    // Y no es que el regalo no se hubiera guardado: la tarjeta que nace DESPUÉS sí lo trae.
    const nueva = await registrarCliente(supabase, comercioId, programaId, 'Nueva', null, telefonoUnico());
    expect(nueva.sellosRegalo).toBe(2);
    expect(await saldoDe(nueva.tarjetaId)).toBe(2);
  });

  it('5. un programa que FUE de sellos con regalo y ya no lo es: la tarjeta nace en 0 y sin fila de regalo', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 2);
    // `update` directo del tipo, a propósito y sin pasar por Marca: es el estado que deja
    // propagarTipoAlProgramaPrincipal cuando FM le cambia el tipo al comercio — cambia el tipo del
    // programa principal y NO limpia sellos_regalo (ni guardarBranding podría fabricarlo: la
    // pantalla de Marca esconde el campo fuera de sellos). La columna queda guardada pero tiene que
    // ser inofensiva: regalar "2 sellos" a una tarjeta de puntos sería un saldo sin sentido.
    const { error } = await supabase.from('programas_tarjeta').update({ tipo_tarjeta: 'puntos' }).eq('id', programaId);
    if (error) throw error;
    // El estado de partida es el que se quiere probar: regalo 2 todavía guardado en un programa de
    // puntos. Sin esto, una función que ignorara el regalo siempre pasaría esta prueba.
    const programa = await obtenerPrograma(supabase, comercioId, programaId);
    expect(programa?.tipoTarjeta).toBe('puntos');
    expect(programa?.sellosRegalo).toBe(2);

    const alta = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefonoUnico());

    expect(alta.esNuevaTarjeta).toBe(true);
    expect(alta.sellosRegalo).toBe(0);
    expect(await saldoDe(alta.tarjetaId)).toBe(0);
    expect(await libroDe(alta.tarjetaId)).toEqual([]);
  });

  it('6. lo que ve el cliente en el pase: "2 de 10" en Apple y el contador en 2 en Google', async () => {
    // Se mide el TEXTO que se dibuja, no la columna: una tarjeta con puntos_actuales = 2 y un pase
    // que dijera "0 de 10" sería el mismo defecto que el regalo vino a evitar.
    const { comercioId, programaId } = await comercioConRegalo(10, 2, { google_class_id: 'issuer-test.comercio_x' });
    const alta = await registrarCliente(supabase, comercioId, programaId, 'Ana', 'Rivera', telefonoUnico());
    expect(alta.sellosRegalo).toBe(2);

    // Apple: la cadena real. datosPassDeTarjeta lee la tarjeta por su serial (registrarCliente se lo
    // dejó puesto), generarPassApple arma el frente con frentePase y lo firma, y el estado de arriba
    // a la derecha se lee en el pass.json que baja el cliente.
    const datosApple = await datosPassDeTarjeta(supabase, alta.tarjetaId);
    expect(datosApple, 'la tarjeta recién registrada tiene que poder emitirse como pase').not.toBeNull();
    expect(datosApple!.datos.puntos).toBe(2);
    expect(datosApple!.datos.selloMeta).toBe(10);
    const zip = await JSZip.loadAsync(await generarPassApple(datosApple!.datos));
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.storeCard.headerFields).toEqual([{ key: 'estado', label: 'SELLOS', value: '2 de 10' }]);

    // Google: el objeto que se manda a la API. Nunca se llama a Google; se lee lo que se le enviaría.
    const sync = await syncObjetoTarjeta(supabase, alta.tarjetaId);
    expect(sync.ok, sync.ok ? '' : sync.error).toBe(true);
    expect(insertMock).toHaveBeenCalledOnce();
    const cuerpo = insertMock.mock.calls[0][0].requestBody;
    expect(cuerpo.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '2 de 10 sellos', int: null } });
    expect(cuerpo.textModulesData).toContainEqual({ id: 'estado', header: 'SELLOS', body: '2 de 10' });
  }, 60_000);

  it('7. regalo 0 (el caso de todos los comercios de hoy): la tarjeta nace en 0 y sin fila de regalo', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 0);

    const alta = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefonoUnico());

    expect(alta.esNuevaTarjeta).toBe(true);
    expect(alta.sellosRegalo).toBe(0);
    expect(await saldoDe(alta.tarjetaId)).toBe(0);
    // Ni una fila con delta 0: sería ruido en el historial de todos los clientes que no regalan nada.
    expect(await libroDe(alta.tarjetaId)).toEqual([]);
  });

  it('8. cada programa regala SU número: un programa de sellos que no es el principal, configurado con guardarBrandingPrograma', async () => {
    // El principal regala 2 (meta 10) y un segundo programa de sellos regala 3 (meta 5), cargado por
    // el camino del modo tarjeta de Marca. Un mismo cliente se registra en los dos: cada tarjeta
    // nace con el regalo de SU programa. Si la función leyera el del principal, la segunda saldría 2.
    const { comercioId, programaId: principalId } = await comercioConRegalo(10, 2);
    const creado = await crearPrograma(supabase, comercioId, {
      nombre: 'Sellos del viernes',
      tipoTarjeta: 'sellos',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });
    if (!creado.ok) throw new Error(creado.error);
    const guardado = await guardarBrandingPrograma(supabase, comercioId, creado.id, {
      brandingPropio: false,
      colorFondo: null,
      colorTexto: null,
      colorLabel: null,
      difuminadoFranja: null,
      encuadreFranja: null,
      oscurecerFranja: null,
      selloMeta: 5,
      sellosRegalo: 3,
      nombrePase: null,
    });
    expect(guardado.ok, guardado.ok ? '' : guardado.error).toBe(true);

    const telefono = telefonoUnico();
    const enPrincipal = await registrarCliente(supabase, comercioId, principalId, 'Ana', null, telefono);
    const enSegundo = await registrarCliente(supabase, comercioId, creado.id, 'Ana', null, telefono);

    expect(enPrincipal.sellosRegalo).toBe(2);
    expect(await saldoDe(enPrincipal.tarjetaId)).toBe(2);
    expect(enSegundo.tarjetaId).not.toBe(enPrincipal.tarjetaId);
    expect(enSegundo.sellosRegalo).toBe(3);
    expect(await saldoDe(enSegundo.tarjetaId)).toBe(3);
    expect(await libroDe(enSegundo.tarjetaId)).toHaveLength(1);
  });

  it('9. la carrera: si la tarjeta aparece entre la búsqueda y la emisión, se recupera la ganadora SIN regalo nuevo', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 2);
    const telefono = telefonoUnico();
    const ganadora = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefono);
    expect(ganadora.sellosRegalo).toBe(2);

    // El segundo registro no ve la tarjeta al buscarla (la ganadora todavía no estaba commiteada
    // cuando él miró), así que llega a emitir_tarjeta, que choca con el unique (cliente, programa) y
    // lanza 23505. registrarCliente tiene que leer ese código en `error.code` de la llamada RPC y
    // converger en la tarjeta de la ganadora.
    const perdedora = await registrarCliente(
      clienteConLecturaCiega(supabase),
      comercioId,
      programaId,
      'Ana',
      null,
      telefono,
    );

    expect(perdedora.tarjetaId).toBe(ganadora.tarjetaId);
    expect(perdedora.qrToken).toBe(ganadora.qrToken);
    expect(perdedora.esNuevaTarjeta).toBe(false);
    // 0 y no 2: quien pierde la carrera no recibió nada. Y como la función abortó entera, no quedó
    // un segundo regalo suelto en el libro ni sellos de más en la tarjeta.
    expect(perdedora.sellosRegalo).toBe(0);
    // Pero la tarjeta que ve la perdedora YA vale 2 (el regalo de la ganadora): su muestra no puede
    // decir "0 de 10" mientras el pase dice "2 de 10".
    expect(perdedora.puntosActuales).toBe(2);
    expect(await saldoDe(ganadora.tarjetaId)).toBe(2);
    expect(await libroDe(ganadora.tarjetaId)).toHaveLength(1);
  });

  it('10. quien vuelve a registrarse con la tarjeta ya movida: sellosRegalo 0 y puntosActuales es el saldo real', async () => {
    // El caso que la tarjeta de muestra dibujaba mal: un cliente con 2 de regalo + 1 sello comprado
    // escanea el QR otra vez. No recibe regalo (0), pero su tarjeta vale 3 y el pase dice "3 de 10".
    const { comercioId, programaId } = await comercioConRegalo(10, 2);
    const telefono = telefonoUnico();
    const primero = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefono);
    const acreditacion = await acreditarPuntos(supabase, comercioId, primero.tarjetaId, 1);
    expect(acreditacion.ok, acreditacion.ok ? '' : acreditacion.error).toBe(true);

    const otraVez = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefono);

    expect(otraVez.tarjetaId).toBe(primero.tarjetaId);
    expect(otraVez.esNuevaTarjeta).toBe(false);
    expect(otraVez.sellosRegalo, 'no ganó nada ahora').toBe(0);
    expect(otraVez.puntosActuales, 'pero su tarjeta vale 3').toBe(3);
    expect(await saldoDe(primero.tarjetaId)).toBe(3);
  });

  it('11. la carrera con la ganadora ya movida: la perdedora ve el saldo real (3), no el del regalo (2) ni 0', async () => {
    const { comercioId, programaId } = await comercioConRegalo(10, 2);
    const telefono = telefonoUnico();
    const ganadora = await registrarCliente(supabase, comercioId, programaId, 'Ana', null, telefono);
    const acreditacion = await acreditarPuntos(supabase, comercioId, ganadora.tarjetaId, 1);
    expect(acreditacion.ok, acreditacion.ok ? '' : acreditacion.error).toBe(true);

    const perdedora = await registrarCliente(
      clienteConLecturaCiega(supabase),
      comercioId,
      programaId,
      'Ana',
      null,
      telefono,
    );

    expect(perdedora.tarjetaId).toBe(ganadora.tarjetaId);
    expect(perdedora.esNuevaTarjeta).toBe(false);
    expect(perdedora.sellosRegalo).toBe(0);
    expect(perdedora.puntosActuales).toBe(3);
  });
});
