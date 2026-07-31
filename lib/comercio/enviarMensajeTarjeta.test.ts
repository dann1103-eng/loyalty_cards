import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { enviarMensajeTarjeta } from './enviarMensajeTarjeta';

// enviarMensajeTarjeta orquesta Apple + Google para una tarjeta puntual. El lado de Apple se
// prueba contra el camino real de notificarCambioTarjeta: sin apple_push_registrations esa
// función retorna temprano sin tocar la red (lib/apple/notificarCambioTarjeta.ts), así que no
// hace falta mockear APNs para los casos de este archivo (ninguno prueba el camino "sí hay
// registro" — eso ya lo cubre notificarCambioTarjeta.test.ts si existe, o queda para cuando se
// pruebe el flujo completo end-to-end).
//
// El lado de Google SÍ necesita mock. Mismo criterio que lib/google/enviarMensaje.test.ts (que
// mockea walletClient en vez de llamar a Google de verdad: las LoyaltyClass de prueba no se
// pueden borrar de la cuenta real — ver CLAUDE.md). Acá se mockea un nivel más arriba,
// enviarMensajeGoogle en sí (el import directo de este módulo), porque lo que enviarMensajeTarjeta
// necesita probar es SU orquestación (el candado de 3/24h, el filtro por canal, el rastro de
// auditoría) — la llamada real a la API de Google ya está cubierta por enviarMensaje.test.ts.
const enviarMensajeGoogleMock = vi.fn();

vi.mock('../google/enviarMensaje', () => ({
  enviarMensajeGoogle: (...args: unknown[]) => enviarMensajeGoogleMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

// notificaciones_enviadas y difusiones no tienen ON DELETE CASCADE (decisión deliberada del
// esquema — ver el comentario de entornoComercio.ts) y entorno.limpiar() no las conoce todavía.
// Si una prueba de este archivo inserta una fila en cualquiera de las dos apuntando a una tarjeta
// o comercio del fixture, borrar esa tarjeta/comercio en limpiar() fallaría con 23503 (silencioso
// — borrar() solo hace console.error, no lanza) y dejaría basura huérfana en la base REAL. Se
// rastrean acá y se limpian ANTES de entorno.limpiar(), en el orden correcto de FKs.
const tarjetasCreadas: string[] = [];
const difusionesCreadas: string[] = [];

beforeEach(() => {
  enviarMensajeGoogleMock.mockReset().mockResolvedValue({ ok: true, tieneUsuarios: true });
});

afterEach(async () => {
  if (tarjetasCreadas.length) {
    await supabase.from('notificaciones_enviadas').delete().in('tarjeta_id', tarjetasCreadas);
    tarjetasCreadas.length = 0;
  }
  if (difusionesCreadas.length) {
    await supabase.from('difusiones').delete().in('id', difusionesCreadas);
    difusionesCreadas.length = 0;
  }
  await entorno.limpiar();
});

describe('enviarMensajeTarjeta', () => {
  it('actualiza aviso_texto/aviso_hasta en la tarjeta', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);

    await enviarMensajeTarjeta(supabase, tarjetaId, 'Volvé pronto', '2026-12-31', 'inactividad');

    const { data } = await supabase.from('tarjetas').select('aviso_texto, aviso_hasta').eq('id', tarjetaId).single();
    expect(data!.aviso_texto).toBe('Volvé pronto');
    expect(data!.aviso_hasta).toBe('2026-12-31');
  });

  it('sin apple_push_registrations, enviadoApple es false y NO inserta fila de auditoría de Apple', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');

    expect(resultado.enviadoApple).toBe(false);
    const { data } = await supabase
      .from('notificaciones_enviadas')
      .select('id')
      .eq('tarjeta_id', tarjetaId)
      .eq('canal', 'apple');
    expect(data).toEqual([]);
  });

  it('sin google_object_id, enviadoGoogle es false', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');

    expect(resultado.enviadoGoogle).toBe(false);
    expect(enviarMensajeGoogleMock).not.toHaveBeenCalled();
  });

  it('con 3 notificaciones canal=google en las últimas 24h, la cuarta se salta (enviadoGoogle: false) sin lanzar', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);
    await supabase.from('tarjetas').update({ google_object_id: 'issuer-test.candado' }).eq('id', tarjetaId);
    // Simula 3 envíos previos de HOY sin llamar a Google de verdad — insert directo del registro.
    await supabase.from('notificaciones_enviadas').insert([
      { tarjeta_id: tarjetaId, canal: 'google', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'google', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'google', origen: 'inactividad' },
    ]);

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');

    // El candado se evalúa ANTES de intentar el envío: con el objeto de Google ya sincronizado,
    // si el candado no bloqueara, enviarMensajeGoogleMock SÍ se llamaría.
    expect(resultado.enviadoGoogle).toBe(false);
    expect(enviarMensajeGoogleMock).not.toHaveBeenCalled();
  });

  it('el header del mensaje es el nombre del COMERCIO, no "Cardly SV"', async () => {
    // En Android el texto de la notificación lo pone Google, pero el header/body sí se ven en el
    // detalle del pase al tocarla. Ahí el cliente tiene que leer el nombre de SU comercio: mandar
    // "Cardly SV" contradice el posicionamiento del producto ("Tu marca, no la nuestra") y le mete
    // a un cliente de la farmacia el nombre de un proveedor que no conoce.
    const comercioId = await entorno.crearComercio({ nombre: 'Farmacias ABC' });
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);
    await supabase.from('tarjetas').update({ google_object_id: 'issuer.obj_header' }).eq('id', tarjetaId);

    await enviarMensajeTarjeta(supabase, tarjetaId, 'Promo del mes', '2026-12-31', 'campana');

    expect(enviarMensajeGoogleMock).toHaveBeenCalledWith(
      'issuer.obj_header',
      'Farmacias ABC',
      'Promo del mes',
    );
  });

  // El conteo que ve el dueño ("6 tarjetas alcanzadas") tiene que ser gente que RECIBIÓ algo, no
  // llamadas a la API que salieron bien. Un LoyaltyObject existe desde que se lo crea, aunque nadie
  // haya guardado el pase: el addmessage devuelve éxito igual y no llega a ningún teléfono. El
  // 2026-07-30, de 6 tarjetas "alcanzadas" en producción solo 2 personas tenían el pase instalado.
  // Apple ya lo hacía bien (mira apple_push_registrations); esto empareja el lado de Google.
  it('un objeto de Google SIN usuarios no cuenta como alcanzada ni deja fila de auditoría', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);
    await supabase.from('tarjetas').update({ google_object_id: 'issuer.obj_sin_usuarios' }).eq('id', tarjetaId);
    // La llamada SALE BIEN; simplemente nadie guardó el pase.
    enviarMensajeGoogleMock.mockResolvedValue({ ok: true, tieneUsuarios: false });

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'campana');

    expect(resultado.enviadoGoogle).toBe(false);
    // Y no se audita: una fila acá diría que a alguien le llegó algo que nadie recibió.
    const { count } = await supabase
      .from('notificaciones_enviadas')
      .select('id', { count: 'exact', head: true })
      .eq('tarjeta_id', tarjetaId)
      .eq('canal', 'google');
    expect(count).toBe(0);
  });

  it('el filtro del candado es por canal=google: 3 notificaciones canal=apple NO cuentan', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);
    await supabase.from('tarjetas').update({ google_object_id: 'issuer-test.candado-canal' }).eq('id', tarjetaId);
    await supabase.from('notificaciones_enviadas').insert([
      { tarjeta_id: tarjetaId, canal: 'apple', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'apple', origen: 'campana' },
      { tarjeta_id: tarjetaId, canal: 'apple', origen: 'inactividad' },
    ]);

    const resultado = await enviarMensajeTarjeta(supabase, tarjetaId, 'Hola', '2026-12-31', 'inactividad');

    // Si el candado contara por tarjeta_id sin filtrar canal, estas 3 filas de Apple bloquearían
    // un intento de Google que no debería estar bloqueado.
    expect(resultado.enviadoGoogle).toBe(true);
    expect(enviarMensajeGoogleMock).toHaveBeenCalledOnce();
    const { data } = await supabase
      .from('notificaciones_enviadas')
      .select('id')
      .eq('tarjeta_id', tarjetaId)
      .eq('canal', 'google');
    expect(data).toHaveLength(1);
  });

  it('difusionId viaja a notificaciones_enviadas.difusion_id cuando origen es campana', async () => {
    const comercioId = await entorno.crearComercio();
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId);
    tarjetasCreadas.push(tarjetaId);
    await supabase.from('tarjetas').update({ google_object_id: 'issuer-test.difusion' }).eq('id', tarjetaId);
    const usuarioId = await entorno.crearCajero(comercioId);
    const { data: difusion, error } = await supabase
      .from('difusiones')
      .insert({ comercio_id: comercioId, mensaje: 'Promo', vigente_hasta: '2026-12-31', creada_por: usuarioId })
      .select('id')
      .single();
    if (error) throw error;
    difusionesCreadas.push(difusion.id);

    await enviarMensajeTarjeta(supabase, tarjetaId, 'Promo', '2026-12-31', 'campana', difusion.id);

    const { data: notif } = await supabase
      .from('notificaciones_enviadas')
      .select('difusion_id')
      .eq('tarjeta_id', tarjetaId)
      .eq('canal', 'google')
      .single();
    expect(notif!.difusion_id).toBe(difusion.id);
  });
});
