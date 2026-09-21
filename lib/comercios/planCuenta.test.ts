import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  resumenPlan,
  solicitarCambioPlan,
  listarSolicitudes,
  resolverSolicitud,
  aplicarPlanDestino,
  activarLicencia,
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
    expect(resumen!.limite).toBe(3);
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

// ─────────────────────────────────────────────────────────────────────────────
// Autogestión de plan (Tanda 4)
// ─────────────────────────────────────────────────────────────────────────────
// Hasta acá, TODO cambio de plan pasaba por FM: el dueño pedía y alguien aprobaba a mano. Eso
// significa que un comercio que llega a su tope un sábado a las 9 de la noche —justo cuando quiere
// abrir otro local y pagar más— queda bloqueado hasta que alguien vea la solicitud.
//
// `aplicarPlanDestino` es lo que ejecuta `confirmarPagoCobro` cuando Wompi confirma un cobro. Antes de la
// pasarela el dueño subía de plan al instante (`subirPlanPorElDueno`, borrada); estas pruebas conservan
// los casos de LÍMITE que aquélla protegía, porque la regla no cambió: al subir el límite nunca baja.
describe('aplicarPlanDestino', () => {
  async function planDe(cuentaId: string) {
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('plan, licencia_monto_mensual, limite_negocios')
      .eq('id', cuentaId)
      .single();
    return data!;
  }

  // Deja la cuenta usando EXACTAMENTE `n` unidades de cupo (n >= 1). `cupoDeCuenta` cuenta cada comercio
  // más cada sucursal que NO es la principal: un comercio es 1 unidad y su principal no suma.
  async function consumirCupo(cuentaId: string, n: number) {
    const comercioId = await crearComercio(cuentaId);
    await crearSucursal(comercioId, true);
    for (let i = 1; i < n; i++) await crearSucursal(comercioId);
  }

  it('subir de Starter a Growth aplica el plan, su precio y su límite', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });

    const res = await aplicarPlanDestino(supabase, cuentaId, 'growth', 'periodo');

    expect(res).toEqual({ ok: true, cambio: true });
    const cuenta = await planDe(cuentaId);
    expect(cuenta.plan).toBe('growth');
    expect(Number(cuenta.licencia_monto_mensual)).toBe(49);
    expect(cuenta.limite_negocios).toBe(3);
  });

  it('subir NUNCA reduce un límite que FM negoció', async () => {
    // El caso que rompe lo obvio: FM le dio a un Starter un cupo de 5 (trato negociado; el límite
    // siempre fue un default sugerido, no una regla). Aplicar el sugerido de Growth —que es 3— al
    // subir de plan le QUITARÍA capacidad al cliente que acaba de pagar más. Gana el mayor.
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 5 });

    const res = await aplicarPlanDestino(supabase, cuentaId, 'growth', 'periodo');

    expect(res.ok).toBe(true);
    expect((await planDe(cuentaId)).limite_negocios, 'le quitó cupo al subir de plan').toBe(5);
  });

  it('subir a Pro aplica su tope de 10 y le gana a un cupo negociado menor', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 5 });

    expect((await aplicarPlanDestino(supabase, cuentaId, 'pro', 'periodo')).ok).toBe(true);
    expect((await planDe(cuentaId)).limite_negocios, 'Pro sugiere 10 y el negociado era 5').toBe(10);
  });

  // EL CASO QUE SE ROMPIÓ AL PONERLE TOPE A PRO (2026-08-13). Antes, Pro era `limiteSugerido: null`,
  // así que el único null posible venía del plan destino. Ahora el null sobrevive solo en las cuentas
  // viejas —las que YA compraron "sin límite"— y el `?? 0` del Math.max las mandaba a Math.max(10, 0) = 10:
  // les revocaba en silencio lo que ya habían pagado, justo en el momento en que aceptaban pagar más.
  it('subir NO le quita el sin-tope a una cuenta que ya lo tenía', async () => {
    const cuentaId = await crearCuenta({ plan: 'growth', licencia_monto_mensual: 49, limite_negocios: null });

    expect((await aplicarPlanDestino(supabase, cuentaId, 'pro', 'periodo')).ok).toBe(true);
    expect((await planDe(cuentaId)).limite_negocios, 'le revocó el sin-tope que ya tenía comprado').toBeNull();
  });

  it('una cuenta SIN plan toma cualquiera del catálogo', async () => {
    // Nace así toda cuenta del alta self-service: sin plan asignado hasta que paga.
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });

    expect((await aplicarPlanDestino(supabase, cuentaId, 'starter', 'periodo')).ok).toBe(true);
    expect((await planDe(cuentaId)).plan).toBe('starter');
  });

  it('rechaza un plan que no está en el catálogo, sin tocar la cuenta', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });

    const res = await aplicarPlanDestino(supabase, cuentaId, 'enterprise', 'periodo');

    expect(res).toMatchObject({ ok: false, motivo: 'error' });
    expect((await planDe(cuentaId)).plan).toBe('starter');
  });

  it('una cuenta que no existe es un error, no una excepción', async () => {
    const res = await aplicarPlanDestino(supabase, '00000000-0000-0000-0000-000000000000', 'growth', 'periodo');
    expect(res).toMatchObject({ ok: false, motivo: 'error' });
  });

  it('aplicar el MISMO plan es un éxito sin cambios, y no pisa un precio negociado', async () => {
    // Es lo que pasa al reintentar un webhook, o al renovar sin cambiar de plan.
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 20, limite_negocios: 4 });

    const res = await aplicarPlanDestino(supabase, cuentaId, 'starter', 'periodo');

    expect(res).toEqual({ ok: true, cambio: false });
    const cuenta = await planDe(cuentaId);
    expect(Number(cuenta.licencia_monto_mensual), 'le pisó el precio negociado').toBe(20);
    expect(cuenta.limite_negocios).toBe(4);
  });

  it('aplicarlo dos veces deja lo mismo que aplicarlo una', async () => {
    const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });

    await aplicarPlanDestino(supabase, cuentaId, 'growth', 'periodo');
    const segunda = await aplicarPlanDestino(supabase, cuentaId, 'growth', 'periodo');

    expect(segunda).toEqual({ ok: true, cambio: false });
    expect(await planDe(cuentaId)).toMatchObject({ plan: 'growth', limite_negocios: 3 });
  });

  describe('un AJUSTE nunca baja', () => {
    it('sobre una cuenta que ya está en un plan más caro no hace nada', async () => {
      // FM le subió el plan a mano mientras el dueño pagaba el ajuste a Growth.
      const cuentaId = await crearCuenta({ plan: 'pro', licencia_monto_mensual: 89, limite_negocios: 10 });

      const res = await aplicarPlanDestino(supabase, cuentaId, 'growth', 'ajuste');

      expect(res).toEqual({ ok: true, cambio: false });
      expect(await planDe(cuentaId)).toMatchObject({ plan: 'pro', limite_negocios: 10 });
    });

    it('sobre una cuenta más chica sí sube', async () => {
      const cuentaId = await crearCuenta({ plan: 'starter', licencia_monto_mensual: 29, limite_negocios: 1 });

      expect(await aplicarPlanDestino(supabase, cuentaId, 'growth', 'ajuste')).toEqual({ ok: true, cambio: true });
      expect((await planDe(cuentaId)).plan).toBe('growth');
    });
  });

  describe('bajar (solo lo hace una renovación)', () => {
    it('baja el plan, su precio y fija el límite sugerido cuando la cuenta cabe', async () => {
      const cuentaId = await crearCuenta({ plan: 'growth', licencia_monto_mensual: 49, limite_negocios: 3 });

      const res = await aplicarPlanDestino(supabase, cuentaId, 'starter', 'periodo');

      expect(res).toEqual({ ok: true, cambio: true });
      const cuenta = await planDe(cuentaId);
      expect(cuenta.plan).toBe('starter');
      expect(Number(cuenta.licencia_monto_mensual)).toBe(29);
      expect(cuenta.limite_negocios).toBe(1);
    });

    it('NO baja si la cuenta quedaría por encima del nuevo cupo, y lo dice con motivo "cupo"', async () => {
      const cuentaId = await crearCuenta({ plan: 'growth', licencia_monto_mensual: 49, limite_negocios: 3 });
      await consumirCupo(cuentaId, 2); // 2 unidades: en Starter (tope 1) no caben

      const res = await aplicarPlanDestino(supabase, cuentaId, 'starter', 'periodo');

      expect(res).toEqual({
        ok: false,
        motivo: 'cupo',
        error: 'La cuenta usa 2 unidades y el plan Starter permite 1.',
      });
      expect(await planDe(cuentaId)).toMatchObject({ plan: 'growth', limite_negocios: 3 });
    });
  });

  it('un piloto sin plan que ya usa más de lo que cabe en el plan elegido no lo recibe', async () => {
    // Sin este chequeo, pagar Starter dejaría a una cuenta con 3 unidades y un tope de 1.
    const cuentaId = await crearCuenta({ plan: null, licencia_monto_mensual: null, limite_negocios: null });
    await consumirCupo(cuentaId, 3);

    const res = await aplicarPlanDestino(supabase, cuentaId, 'starter', 'periodo');

    expect(res).toMatchObject({ ok: false, motivo: 'cupo' });
    expect((await planDe(cuentaId)).plan).toBeNull();
  });
});

describe('activarLicencia', () => {
  async function licenciaDe(cuentaId: string) {
    const { data } = await supabase
      .from('cuentas_comercio')
      .select('licencia_estado, licencia_activa_desde')
      .eq('id', cuentaId)
      .single();
    return data!;
  }

  it('pasa la cuenta a activo y le pone la fecha de alta', async () => {
    const cuentaId = await crearCuenta({ licencia_estado: 'inactivo', licencia_activa_desde: null });

    await activarLicencia(supabase, cuentaId, '2026-09-15');

    expect(await licenciaDe(cuentaId)).toEqual({ licencia_estado: 'activo', licencia_activa_desde: '2026-09-15' });
  });

  it('no le corre la fecha de alta a una cuenta que ya la tenía (una renovación, o un reintento)', async () => {
    const cuentaId = await crearCuenta({ licencia_estado: 'activo', licencia_activa_desde: '2026-01-10' });

    await activarLicencia(supabase, cuentaId, '2026-09-15');

    expect(await licenciaDe(cuentaId)).toEqual({ licencia_estado: 'activo', licencia_activa_desde: '2026-01-10' });
  });

  it('LANZA si la cuenta no existe: un error acá tiene que cortar el flujo para que el reintento lo complete', async () => {
    await expect(activarLicencia(supabase, '00000000-0000-0000-0000-000000000000', '2026-09-15')).rejects.toThrow(
      'No se pudo leer la cuenta',
    );
  });
});
