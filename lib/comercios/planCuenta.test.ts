import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  resumenPlan,
  solicitarCambioPlan,
  listarSolicitudes,
  resolverSolicitud,
  etiquetaDePlan,
  SIN_PLAN,
  ETIQUETA_SIN_PLAN,
} from './planCuenta';

const supabase = createServiceClient();
const cuentas: string[] = [];
const comercios: string[] = [];
const sucursales: string[] = [];

afterEach(async () => {
  if (sucursales.length) await supabase.from('sucursales').delete().in('id', sucursales);
  if (comercios.length) await supabase.from('comercios').delete().in('id', comercios);
  if (cuentas.length) {
    await supabase.from('solicitudes_plan').delete().in('cuenta_id', cuentas);
    await supabase.from('cobros').delete().in('cuenta_id', cuentas);
    await supabase.from('cuentas_comercio').delete().in('id', cuentas);
  }
  sucursales.length = 0;
  comercios.length = 0;
  cuentas.length = 0;
});

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function crearCuenta(campos: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Prueba ${sufijo()}`, ...campos })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

async function crearComercio(cuentaId: string): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Plan', slug: `test-plan-${sufijo()}`, cuenta_id: cuentaId })
    .select('id')
    .single();
  if (error) throw error;
  comercios.push(data.id);
  return data.id;
}

async function crearSucursal(comercioId: string, esPrincipal = false): Promise<string> {
  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre: 'Sucursal Plan', es_principal: esPrincipal })
    .select('id')
    .single();
  if (error) throw error;
  sucursales.push(data.id);
  return data.id;
}

describe('etiquetaDePlan', () => {
  it('trata el plan ausente como "sin plan asignado", no como un valor raro', () => {
    // Es el estado REAL de todas las cuentas del piloto: la migración 0011 dejó plan en null a
    // propósito para no inventar un dato. La pantalla lo ve como caso normal, no como error.
    expect(etiquetaDePlan(null)).toBe(ETIQUETA_SIN_PLAN);
    expect(etiquetaDePlan(SIN_PLAN)).toBe(ETIQUETA_SIN_PLAN);
    expect(etiquetaDePlan('growth')).toBe('Growth');
  });
});

describe('resumenPlan', () => {
  it('devuelve el plan, el monto y el consumo real contra el límite', async () => {
    const cuentaId = await crearCuenta({ plan: 'growth', licencia_monto_mensual: 49, limite_negocios: 2 });
    const comercioId = await crearComercio(cuentaId);
    await crearSucursal(comercioId, true); // la principal NO consume cupo
    await crearSucursal(comercioId); // ésta sí

    const resumen = await resumenPlan(supabase, cuentaId);

    expect(resumen).not.toBeNull();
    expect(resumen!.plan).toBe('growth');
    expect(resumen!.etiquetaPlan).toBe('Growth');
    expect(resumen!.montoMensual).toBe(49);
    expect(resumen!.limite).toBe(2);
    // 1 comercio + 1 sucursal no principal = 2. La principal es gratis: si este número saliera 3,
    // el dueño vería su cupo lleno cuando en realidad le cabe otra.
    expect(resumen!.usadas).toBe(2);
  });

  it('funciona con una cuenta sin plan asignado', async () => {
    const cuentaId = await crearCuenta();
    const resumen = await resumenPlan(supabase, cuentaId);
    expect(resumen!.plan).toBeNull();
    expect(resumen!.etiquetaPlan).toBe(ETIQUETA_SIN_PLAN);
  });
});

describe('solicitarCambioPlan', () => {
  it('crea la solicitud guardando de qué plan venía', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter' });

    const res = await solicitarCambioPlan(supabase, cuentaId, 'growth', 'Abrimos otra sucursal');
    expect(res.ok).toBe(true);

    const resumen = await resumenPlan(supabase, cuentaId);
    expect(resumen!.solicitudPendiente).not.toBeNull();
    expect(resumen!.solicitudPendiente!.planActual).toBe('starter');
    expect(resumen!.solicitudPendiente!.planSolicitado).toBe('growth');
    expect(resumen!.solicitudPendiente!.motivo).toBe('Abrimos otra sucursal');
  });

  it('guarda el marcador de "sin plan" cuando la cuenta no tenía ninguno', async () => {
    const cuentaId = await crearCuenta();
    await solicitarCambioPlan(supabase, cuentaId, 'starter', '');
    const resumen = await resumenPlan(supabase, cuentaId);
    expect(resumen!.solicitudPendiente!.planActual).toBe(SIN_PLAN);
  });

  it('rechaza una SEGUNDA solicitud pendiente con un mensaje entendible', async () => {
    // El índice único parcial de la BD devuelve 23505; sin traducirlo, el dueño vería un código.
    const cuentaId = await crearCuenta({ plan: 'starter' });
    expect((await solicitarCambioPlan(supabase, cuentaId, 'growth', '')).ok).toBe(true);

    const segunda = await solicitarCambioPlan(supabase, cuentaId, 'pro', '');
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error).toBe('Ya tenés una solicitud pendiente. Esperá a que la revisemos.');
  });

  it('rechaza pedir el plan que ya se tiene', async () => {
    const cuentaId = await crearCuenta({ plan: 'growth' });
    const res = await solicitarCambioPlan(supabase, cuentaId, 'growth', '');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Ya estás en ese plan.');
  });

  it('rechaza un plan que no existe en el catálogo', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter' });
    const res = await solicitarCambioPlan(supabase, cuentaId, 'enterprise', '');
    expect(res.ok).toBe(false);
  });
});

describe('resolverSolicitud', () => {
  async function solicitudDe(cuentaId: string): Promise<string> {
    const lista = await listarSolicitudes(supabase, true);
    return lista!.find((s) => s.cuentaId === cuentaId)!.id;
  }

  it('aprobar aplica el plan, su monto y su límite', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });
    await solicitarCambioPlan(supabase, cuentaId, 'growth', 'crecimos');

    const res = await resolverSolicitud(supabase, await solicitudDe(cuentaId), true, 'Aprobado');
    expect(res.ok).toBe(true);

    const resumen = await resumenPlan(supabase, cuentaId);
    expect(resumen!.plan).toBe('growth');
    expect(resumen!.montoMensual).toBe(49);
    expect(resumen!.limite).toBe(2);
    // Ya no queda pendiente: si siguiera, el dueño no podría pedir otro cambio nunca más.
    expect(resumen!.solicitudPendiente).toBeNull();
  });

  it('NO deja bajar de plan si la cuenta quedaría por encima del nuevo cupo', async () => {
    // La regla que evita dejar una cuenta en un estado que el propio sistema considera inválido:
    // verificarLimiteCuenta la bloquearía en la siguiente alta y nadie entendería por qué.
    const cuentaId = await crearCuenta({ plan: 'growth', limite_negocios: 2 });
    const comercioId = await crearComercio(cuentaId);
    await crearSucursal(comercioId); // 1 comercio + 1 sucursal = 2 unidades
    await solicitarCambioPlan(supabase, cuentaId, 'starter', 'quiero pagar menos');

    const res = await resolverSolicitud(supabase, await solicitudDe(cuentaId), true, '');

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('desactive negocios o sucursales');

    // Y el plan NO se movió: un rechazo a medias (plan cambiado, solicitud sin resolver) sería peor
    // que no hacer nada.
    const resumen = await resumenPlan(supabase, cuentaId);
    expect(resumen!.plan).toBe('growth');
    expect(resumen!.solicitudPendiente).not.toBeNull();
  });

  it('deja bajar de plan cuando el consumo sí entra', async () => {
    const cuentaId = await crearCuenta({ plan: 'growth', limite_negocios: 2 });
    await crearComercio(cuentaId); // 1 unidad, entra en Starter (límite 1)
    await solicitarCambioPlan(supabase, cuentaId, 'starter', '');

    const res = await resolverSolicitud(supabase, await solicitudDe(cuentaId), true, '');
    expect(res.ok).toBe(true);
    expect((await resumenPlan(supabase, cuentaId))!.plan).toBe('starter');
  });

  it('rechazar deja el comentario y NO toca el plan', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', limite_negocios: 1 });
    await solicitarCambioPlan(supabase, cuentaId, 'pro', 'porfa');

    const res = await resolverSolicitud(supabase, await solicitudDe(cuentaId), false, 'Hablemos primero');
    expect(res.ok).toBe(true);

    const resumen = await resumenPlan(supabase, cuentaId);
    expect(resumen!.plan).toBe('starter');
    expect(resumen!.solicitudPendiente).toBeNull();

    const historial = await listarSolicitudes(supabase, false);
    const suya = historial!.find((s) => s.cuentaId === cuentaId)!;
    expect(suya.estado).toBe('rechazada');
    expect(suya.comentarioFm).toBe('Hablemos primero');
    // La BD exige fecha de resolución en toda solicitud no pendiente.
    expect(suya.resueltaEn).not.toBeNull();
  });

  it('no se puede resolver dos veces', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', limite_negocios: 1 });
    await solicitarCambioPlan(supabase, cuentaId, 'growth', '');
    const id = await solicitudDe(cuentaId);

    expect((await resolverSolicitud(supabase, id, true, '')).ok).toBe(true);
    const segunda = await resolverSolicitud(supabase, id, false, '');
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.error).toBe('Esa solicitud ya fue resuelta.');
  });
});
