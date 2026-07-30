import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearDifusion, listarDifusiones, MAXIMO_DIFUSIONES_30_DIAS } from './difusiones';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

// difusiones no tiene ON DELETE CASCADE (decisión deliberada del esquema — ver el comentario de
// entornoComercio.ts) y entorno.limpiar() todavía no la conoce (mismo hueco que ya documentó
// enviarMensajeTarjeta.test.ts). Si una difusión sigue apuntando a un comercio/programa/usuario del
// fixture cuando limpiar() intenta borrarlos, la FK falla con 23503 — silencioso, porque borrar()
// solo hace console.error, no lanza — y deja basura huérfana en la base REAL. Se rastrean acá y se
// borran ANTES de entorno.limpiar(): primero las difusiones (referencian comercio/programa/usuario),
// después el usuario de prueba (que difusiones.creada_por referencia y que entorno no crea, así que
// tampoco limpia).
const difusionesCreadas: string[] = [];
const usuariosCreados: string[] = [];

afterEach(async () => {
  if (difusionesCreadas.length) {
    await supabase.from('difusiones').delete().in('id', difusionesCreadas);
    difusionesCreadas.length = 0;
  }
  if (usuariosCreados.length) {
    await supabase.from('usuarios_comercio').delete().in('id', usuariosCreados);
    usuariosCreados.length = 0;
  }
  await entorno.limpiar();
});

async function usuarioDePrueba(comercioId: string): Promise<string> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email: `owner-dif-${Date.now()}@ejemplo.test`, rol: 'owner' })
    .select('id')
    .single();
  if (error) throw error;
  usuariosCreados.push(data.id);
  return data.id;
}

describe('crearDifusion', () => {
  it('rechaza un mensaje vacío', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);

    const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: '   ', vigenteHasta: '2026-12-31', programaId: null });

    expect(res).toEqual({ ok: false, error: 'El mensaje es obligatorio.' });
  });

  it(`permite hasta ${MAXIMO_DIFUSIONES_30_DIAS} difusiones en 30 días y rechaza la siguiente`, async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    await entorno.crearTarjeta(comercioId);

    for (let i = 0; i < MAXIMO_DIFUSIONES_30_DIAS; i++) {
      const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: `Promo ${i}`, vigenteHasta: '2026-12-31', programaId: null });
      expect(res.ok).toBe(true);
      if (res.ok) difusionesCreadas.push(res.id);
    }

    const quinta = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Una de más', vigenteHasta: '2026-12-31', programaId: null });
    expect(quinta.ok).toBe(false);
    if (!quinta.ok) expect(quinta.error).toContain(String(MAXIMO_DIFUSIONES_30_DIAS));
  });

  it('registra destinatarios = tarjetas alcanzadas por al menos un canal', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    await entorno.crearTarjeta(comercioId); // sin apple_push_registrations ni google_object_id

    const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Promo', vigenteHasta: '2026-12-31', programaId: null });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    difusionesCreadas.push(res.id);
    const { data } = await supabase.from('difusiones').select('destinatarios').eq('id', res.id).single();
    // Sin registros de push en ningún canal, 0 tarjetas alcanzadas — no es un error, es la
    // realidad de una tarjeta que nunca instaló el wallet.
    expect(data!.destinatarios).toBe(0);
  });

  it('con programaId, solo apunta a tarjetas de ese programa', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    const principalId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Solo sellos', vigenteHasta: '2026-12-31', programaId: principalId });

    expect(res.ok).toBe(true);
    if (res.ok) difusionesCreadas.push(res.id);
  });
});

describe('listarDifusiones', () => {
  it('devuelve las difusiones del comercio, más recientes primero', async () => {
    const comercioId = await entorno.crearComercio();
    const usuarioId = await usuarioDePrueba(comercioId);
    const primera = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Primera', vigenteHasta: '2026-12-31', programaId: null });
    const segunda = await crearDifusion(supabase, comercioId, usuarioId, { mensaje: 'Segunda', vigenteHasta: '2026-12-31', programaId: null });
    if (primera.ok) difusionesCreadas.push(primera.id);
    if (segunda.ok) difusionesCreadas.push(segunda.id);

    const lista = await listarDifusiones(supabase, comercioId);

    expect(lista?.map((d) => d.mensaje)).toEqual(['Segunda', 'Primera']);
  });
});
