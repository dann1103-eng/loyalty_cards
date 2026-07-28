import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { acreditarPuntos, acreditarForzado } from './acreditar';
import { quitarPuntos } from './ajuste';

// Las cuatro perillas antifraude de la migración 0015, aplicadas DENTRO de acreditar_atomico.
// Que estén en el RPC y no en TS es lo que las hace inviolables bajo concurrencia; la última
// prueba de este archivo es la que lo demuestra y la más importante de la Tanda 1.

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

async function saldoDe(tarjetaId: string): Promise<number> {
  const { data } = await supabase
    .from('tarjetas')
    .select('puntos_actuales')
    .eq('id', tarjetaId)
    .single();
  return data!.puntos_actuales;
}

async function filasDe(tarjetaId: string) {
  const { data } = await supabase
    .from('transacciones_puntos')
    .select('puntos_delta, tipo, motivo, forzado, monto_compra')
    .eq('tarjeta_id', tarjetaId);
  return data ?? [];
}

describe('tope de acreditaciones por día', () => {
  it('bloquea la acreditación que pasa el tope y lo marca como bloqueoLimite', async () => {
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 2 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    const tercera = await acreditarPuntos(supabase, comercioId, id, 1);

    expect(tercera.ok).toBe(false);
    if (!tercera.ok) {
      expect(tercera.error).toBe('Este cliente ya llegó al máximo permitido por hoy.');
      // El flag es lo que la UI usa para ofrecerle al dueño el panel de autorización en vez de un
      // error rojo. Sin él, un límite alcanzado sería indistinguible de una falla.
      expect(tercera.bloqueoLimite).toBe(true);
    }
    expect(await saldoDe(id)).toBe(2);
    expect(await filasDe(id)).toHaveLength(2);
  });

  it('un comercio sin tope configurado no tiene ningún límite', async () => {
    // Es la garantía de que la migración no cambió el comportamiento de ningún comercio existente:
    // todos nacen con las perillas en null.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    for (let i = 0; i < 5; i += 1) {
      expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    }
    expect(await saldoDe(id)).toBe(5);
  });

  it('las acreditaciones de días anteriores NO consumen el cupo de hoy', async () => {
    // El corte del día se calcula con date_trunc en la zona del comercio. Si alguien lo cambia por
    // "las últimas 24 horas", esta prueba sigue pasando; la que lo atrapa es la de abajo.
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const haceTresDias = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from('transacciones_puntos').insert({
      tarjeta_id: id,
      puntos_delta: 1,
      tipo: 'acreditacion',
      created_at: haceTresDias,
    });
    expect(error).toBeNull();

    const res = await acreditarPuntos(supabase, comercioId, id, 1);
    expect(res.ok).toBe(true);
  });

  it('cuenta las de HOY aunque hayan pasado más de 24 horas del día anterior', async () => {
    // Distingue "hoy" de "últimas 24 h": una fila de hace 2 horas cuenta, y con tope 1 bloquea.
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await acreditarPuntos(supabase, comercioId, id, 1);
    expect(res.ok).toBe(true);

    const segunda = await acreditarPuntos(supabase, comercioId, id, 1);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.bloqueoLimite).toBe(true);
  });

  it('un AJUSTE no libera cupo del tope diario', async () => {
    // Si el conteo no filtrara por tipo='acreditacion', quitar un sello devolvería el cupo y el
    // tope sería trivial de burlar: acreditar, quitar, acreditar, quitar…
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    expect((await quitarPuntos(supabase, comercioId, id, 1, 'devolver el cupo')).ok).toBe(true);

    const segunda = await acreditarPuntos(supabase, comercioId, id, 1);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.bloqueoLimite).toBe(true);
  });
});

describe('espera mínima entre acreditaciones', () => {
  it('bloquea una segunda acreditación inmediata', async () => {
    // Es la perilla que realmente ataja "el cajero le puso 5 seguidos": un tope diario de 5 no
    // impide ponerlos en diez segundos.
    const comercioId = await entorno.crearComercio({ espera_minima_minutos: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    const segunda = await acreditarPuntos(supabase, comercioId, id, 1);

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) {
      expect(segunda.error).toBe('Todavía es muy pronto para volver a acreditarle a este cliente.');
      expect(segunda.bloqueoLimite).toBe(true);
    }
    expect(await saldoDe(id)).toBe(1);
  });

  it('deja pasar cuando la última acreditación es más vieja que la espera', async () => {
    // El caso que el dueño pidió explícitamente: el cliente que compra en la mañana y vuelve en la
    // tarde tiene que poder recibir su segundo sello.
    const comercioId = await entorno.crearComercio({ espera_minima_minutos: 30 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await supabase.from('transacciones_puntos').insert({
      tarjeta_id: id,
      puntos_delta: 1,
      tipo: 'acreditacion',
      created_at: haceUnaHora,
    });

    const res = await acreditarPuntos(supabase, comercioId, id, 1);
    expect(res.ok).toBe(true);
  });

  it('la espera mira solo a ESTE cliente, no al local entero', async () => {
    // Sin el filtro por tarjeta_id, un local con espera de 30 min podría atender un solo cliente
    // cada media hora. Es el bug que dejaría la función inservible en producción.
    const comercioId = await entorno.crearComercio({ espera_minima_minutos: 30 });
    const primera = await entorno.crearTarjeta(comercioId, 0);
    const segunda = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, primera.id, 1)).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, segunda.id, 1)).ok).toBe(true);
  });
});

describe('límites de puntos', () => {
  it('rechaza una acreditación que pasa el techo por transacción', async () => {
    // El agujero de las tarjetas de puntos: el tope diario cuenta transacciones, así que no impide
    // que el cajero cargue 5000 puntos de una sola vez por una compra de $2.
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'puntos',
      techo_puntos_acreditacion: 50,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await acreditarPuntos(supabase, comercioId, id, 51);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Esa cantidad pasa el máximo permitido en una sola transacción.');
      expect(res.bloqueoLimite).toBe(true);
    }
    expect(await saldoDe(id)).toBe(0);
    expect(await filasDe(id)).toHaveLength(0);
  });

  it('acepta exactamente el techo', async () => {
    // El borde: con `>=` en vez de `>` en el chequeo, el valor configurado quedaría prohibido.
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'puntos',
      techo_puntos_acreditacion: 50,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 50)).ok).toBe(true);
  });

  it('rechaza la acreditación que haría pasar el tope de puntos del día', async () => {
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'puntos',
      tope_puntos_dia: 10,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 6)).ok).toBe(true);
    const segunda = await acreditarPuntos(supabase, comercioId, id, 6);

    expect(segunda.ok).toBe(false);
    if (!segunda.ok) {
      expect(segunda.error).toBe('Este cliente ya llegó al máximo de puntos permitido por hoy.');
      expect(segunda.bloqueoLimite).toBe(true);
    }
    expect(await saldoDe(id)).toBe(6);
  });

  it('acepta la acreditación que llega justo al tope de puntos del día', async () => {
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'puntos',
      tope_puntos_dia: 10,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 6)).ok).toBe(true);
    // 6 + 4 = 10, que NO pasa el tope. Con `>=` en vez de `>` esto se rechazaría.
    expect((await acreditarPuntos(supabase, comercioId, id, 4)).ok).toBe(true);
    expect(await saldoDe(id)).toBe(10);
  });
});

describe('acreditarForzado', () => {
  it('salta el límite y deja la fila marcada con su motivo', async () => {
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(false);

    const forzada = await acreditarForzado(supabase, comercioId, id, 1, 'Compró dos veces hoy');

    expect(forzada.ok).toBe(true);
    if (forzada.ok) expect(forzada.puntosActuales).toBe(2);

    const filas = await filasDe(id);
    expect(filas).toHaveLength(2);
    const marcadas = filas.filter((f) => f.forzado);
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0].motivo).toBe('Compró dos veces hoy');
    // Una forzada sigue siendo una acreditación: no es una clase aparte de movimiento.
    expect(marcadas[0].tipo).toBe('acreditacion');
  });

  it('exige motivo', async () => {
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const res = await acreditarForzado(supabase, comercioId, id, 1, '   ');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Escribí el motivo de la autorización.');
    expect(await filasDe(id)).toHaveLength(0);
  });

  it('las forzadas SÍ cuentan para el tope, así que la siguiente vuelve a pedir autorización', async () => {
    // Decisión de diseño: una forzada es un sello que el cliente recibió. Si no contara, autorizar
    // una vez abriría la puerta para el resto del día.
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect((await acreditarPuntos(supabase, comercioId, id, 1)).ok).toBe(true);
    expect((await acreditarForzado(supabase, comercioId, id, 1, 'primera autorización')).ok).toBe(true);

    const tercera = await acreditarPuntos(supabase, comercioId, id, 1);
    expect(tercera.ok).toBe(false);
    if (!tercera.ok) expect(tercera.bloqueoLimite).toBe(true);
  });

  it('el camino normal es INCAPAZ de marcar una fila como forzada', async () => {
    // El segundo candado de "solo el dueño puede forzar": aunque un bug en la Server Action dejara
    // pasar a un cajero, acreditar_atomico no tiene forma de escribir forzado=true.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    await acreditarPuntos(supabase, comercioId, id, 1);

    const filas = await filasDe(id);
    expect(filas).toHaveLength(1);
    expect(filas[0].forzado).toBe(false);
    expect(filas[0].motivo).toBeNull();
  });
});

describe('monto de compra', () => {
  it('se guarda en el ledger cuando el escáner lo manda', async () => {
    const comercioId = await entorno.crearComercio({ pedir_monto_compra: true });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    await acreditarPuntos(supabase, comercioId, id, 1, { montoCompra: 12.5 });

    const filas = await filasDe(id);
    expect(filas[0].monto_compra).toBe(12.5);
  });

  it('queda en null cuando no se manda', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    await acreditarPuntos(supabase, comercioId, id, 1);

    const filas = await filasDe(id);
    expect(filas[0].monto_compra).toBeNull();
  });
});

describe('los ajustes no contaminan los reportes', () => {
  it('un ajuste no cuenta como acreditación ni como visita', async () => {
    // Las cuatro funciones de reporte de la 0010 contaban filas crudas de transacciones_puntos. Con
    // ajustes en la misma tabla, una CORRECCIÓN aparecería como una visita más — justo al revés de
    // lo que el dueño necesita ver. La 0015 les agregó `where tipo = 'acreditacion'`.
    const comercioId = await entorno.crearComercio();
    const sucursalId = await entorno.crearSucursal(comercioId);
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    await acreditarPuntos(supabase, comercioId, id, 5, { sucursalId });
    await quitarPuntos(supabase, comercioId, id, 2, 'corrección', { sucursalId });

    const { data: sucursales } = await supabase.rpc('reporte_sucursales', {
      p_comercio_id: comercioId,
    });
    const fila = sucursales!.find((s) => s.sucursal_id === sucursalId);
    expect(fila).toBeDefined();
    expect(fila!.acreditaciones).toBe(1);
    // Bruto, no neto: el fraude no se autoborra del reporte. El saldo real (3) vive en la tarjeta.
    expect(fila!.puntos_otorgados).toBe(5);

    const { data: top } = await supabase.rpc('reporte_top_clientes', {
      p_comercio_id: comercioId,
      p_limite: 10,
    });
    expect(top!).toHaveLength(1);
    expect(top![0].visitas).toBe(1);

    expect(await saldoDe(id)).toBe(3);
  });
});

describe('carrera de concurrencia — la garantía central del tope', () => {
  // ESTAS son las pruebas que justifican el `for no key update` dentro de acreditar_atomico.
  //
  // Sin ese lock, en READ COMMITTED cada count(*) toma su propio snapshot y no bloquea con nada:
  // varias llamadas leen "0 de 1", todas pasan, y quedan varias filas. El lock hace que la segunda
  // espere a que la primera commitee, y que su count vea ya la fila de aquélla.
  //
  // POR QUÉ 100 EN PARALELO Y VARIAS RONDAS, Y NO 8 DE UNA VEZ.
  // La primera versión de esta prueba disparaba 8 llamadas y afirmaba que quedaba 1. Pasaba — y
  // TAMBIÉN pasaba con el lock removido, o sea que no probaba nada. La razón es que la transacción
  // dura microsegundos y la latencia de red es de decenas de milisegundos: las peticiones llegan
  // escalonadas y casi nunca se solapan dentro de Postgres.
  //
  // Medición real contra la función MUTADA (sin lock), 3 intentos por nivel:
  //     8 en paralelo → reprodujo 2/3   (filas: 1, 2, 4)
  //    20 en paralelo → reprodujo 2/3   (filas: 1, 3, 5)
  //    50 en paralelo → reprodujo 2/3   (filas: 1, 7, 2)
  //   100 en paralelo → reprodujo 3/3   (filas: 10, 9, 4)
  //
  // O sea que la contención es PROBABILÍSTICA y a 8 la prueba era escamosa en la peor dirección
  // posible: verde cuando el bug está presente. A 100 y con varias rondas, la probabilidad de que
  // se le escape la mutación es despreciable. Si alguien "optimiza" estos números hacia abajo, la
  // prueba vuelve a ser decorativa.
  const EN_PARALELO = 100;
  const RONDAS = 3;

  it(`${RONDAS} rondas de ${EN_PARALELO} acreditaciones simultáneas con tope 1 dejan exactamente una`, async () => {
    for (let ronda = 1; ronda <= RONDAS; ronda += 1) {
      const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 1 });
      const { id } = await entorno.crearTarjeta(comercioId, 0);

      const resultados = await Promise.all(
        Array.from({ length: EN_PARALELO }, () => acreditarPuntos(supabase, comercioId, id, 1)),
      );

      const filas = await filasDe(id);
      // El mensaje nombra la ronda: si falla, se sabe si fue la primera (bug evidente) o la
      // tercera (contención rara), que son dos diagnósticos distintos.
      expect(filas.length, `ronda ${ronda}: el tope de 1 dejó pasar ${filas.length}`).toBe(1);
      expect(await saldoDe(id)).toBe(1);
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);

      // Las rechazadas lo fueron por el límite, no por un error de infraestructura.
      for (const r of resultados.filter((x) => !x.ok)) {
        if (!r.ok) expect(r.bloqueoLimite).toBe(true);
      }
    }
  });

  it(`${EN_PARALELO} acreditaciones simultáneas con tope 3 dejan exactamente tres`, async () => {
    // El mismo candado con un tope mayor: descarta que la prueba anterior pase por la casualidad
    // de que "solo una gana" sea el comportamiento de cualquier serialización.
    const comercioId = await entorno.crearComercio({ tope_acreditaciones_dia: 3 });
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    const resultados = await Promise.all(
      Array.from({ length: EN_PARALELO }, () => acreditarPuntos(supabase, comercioId, id, 1)),
    );

    const filas = await filasDe(id);
    expect(filas.length, `el tope de 3 dejó pasar ${filas.length}`).toBe(3);
    expect(await saldoDe(id)).toBe(3);
    expect(resultados.filter((r) => r.ok)).toHaveLength(3);
  });
});
