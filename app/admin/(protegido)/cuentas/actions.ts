'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearCuenta,
  actualizarCuenta,
  eliminarCuenta,
  asignarComercioACuenta,
} from '@/lib/comercios/cuentas';
import type { DatosCuenta } from '@/lib/comercios/cuentas';
import {
  anularCobroPendiente,
  obtenerCobro,
  obtenerCobroParaPagoDeLaCuenta,
  registrarCobro,
} from '@/lib/comercios/cobros';
import { marcarCobroPagadoAMano } from '@/lib/comercios/resolverPagos';
import { dependenciasResolver } from '@/lib/comercios/resolverPagosSupabase';
import { notificarPagoAMeta } from '@/lib/marketing/conversionesMeta';
import { pedirPago } from '@/lib/comercios/pedirPago';

export type EstadoFormulario = { error: string } | undefined;

// Las acciones NO validan: toda la validación vive en la capa lib (cuentas.ts), que es la que
// tiene tests de integración. Aquí solo: autenticar, parsear, delegar. Mismo patrón que
// comercios/actions.ts.
function leerDatos(formData: FormData): DatosCuenta {
  const limiteRaw = String(formData.get('limite_negocios') ?? '').trim();
  const montoRaw = String(formData.get('licencia_monto_mensual') ?? '').trim();
  const fechaRaw = String(formData.get('licencia_activa_desde') ?? '').trim();
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    // '' = sin límite (null). Number('3a') es NaN → validarDatosCuenta lo rechaza (no matchea
    // "es null" ni "es entero >= 1", cae en el mensaje de rango).
    limiteNegocios: limiteRaw === '' ? null : Number(limiteRaw),
    plan: String(formData.get('plan') ?? ''),
    licenciaEstado: String(formData.get('licencia_estado') ?? 'activo'),
    licenciaMontoMensual: montoRaw === '' ? null : Number(montoRaw),
    licenciaActivaDesde: fechaRaw === '' ? null : fechaRaw,
  };
}

export async function accionCrearCuenta(
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  // Cada Server Action verifica por su cuenta (son POST a la ruta donde se usan). OJO:
  // verifyFmAdmin() usa redirect(), que funciona LANZANDO. Nunca lo envuelvas en try/catch.
  await verifyFmAdmin();

  // `cobranza` es EXCLUSIVO del alta: se lee acá, aparte de leerDatos (que comparte
  // accionActualizarCuenta) — ver el comentario de crearCuenta en lib/comercios/cuentas.ts. Si el
  // campo no viene en el FormData, undefined deja que el default 'normal' de crearCuenta actúe.
  const cobranzaRaw = formData.get('cobranza');
  const cobranza = cobranzaRaw === null ? undefined : String(cobranzaRaw);

  const res = await crearCuenta(createServiceClient(), leerDatos(formData), cobranza);
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/cuentas');
  redirect('/admin/cuentas');
}

export async function accionActualizarCuenta(
  id: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await actualizarCuenta(createServiceClient(), id, leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/cuentas');
  redirect('/admin/cuentas');
}

export async function accionEliminarCuenta(
  id: string,
  _estadoPrevio: EstadoFormulario,
  _formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await eliminarCuenta(createServiceClient(), id);
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/cuentas');
  redirect('/admin/cuentas');
}

export async function accionVincularComercio(
  cuentaId: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const comercioId = String(formData.get('comercio_id') ?? '');
  if (!comercioId) return { error: 'Elegí un negocio para vincular.' };

  // asignarComercioACuenta verifica el límite de ESTA cuenta (excluyendo al propio comercio) antes
  // de mover el cuenta_id: aunque la UI solo muestre el vínculo cuando hay cupo, una carrera podría
  // llenarla en el medio y la capa lib es la que de verdad lo impide.
  const res = await asignarComercioACuenta(createServiceClient(), comercioId, cuentaId);
  if (!res.ok) return { error: res.error };

  revalidatePath(`/admin/cuentas/${cuentaId}`);
  revalidatePath('/admin/cuentas');
  redirect(`/admin/cuentas/${cuentaId}`);
}

export type EstadoCobro = { error: string } | { ok: true } | undefined;

// Registra un cobro de la cuenta. Seguimiento, NO facturación fiscal: el comprobante que ve el
// dueño lo dice en el propio documento (sin personería jurídica no hay DTE).
export async function accionRegistrarCobro(
  cuentaId: string,
  _estadoPrevio: EstadoCobro,
  formData: FormData,
): Promise<EstadoCobro> {
  await verifyFmAdmin();

  const estadoCobro = String(formData.get('estado_cobro') ?? 'pendiente');
  const pagadoEn = String(formData.get('pagado_en') ?? '').trim();

  const supabase = createServiceClient();
  const monto = Number(String(formData.get('monto') ?? '').trim());
  const res = await registrarCobro(supabase, cuentaId, {
    periodoDesde: String(formData.get('periodo_desde') ?? ''),
    periodoHasta: String(formData.get('periodo_hasta') ?? ''),
    monto,
    estado: estadoCobro,
    metodo: String(formData.get('metodo') ?? '') || null,
    nota: String(formData.get('nota') ?? '') || null,
    // Solo viaja si el cobro está pagado: mandarla con otro estado lo rechaza la validación (y el
    // CHECK de la BD), que es lo correcto — una fecha de pago en un cobro pendiente es un dato falso.
    pagadoEn: estadoCobro === 'pagado' ? pagadoEn || null : null,
  });
  if (!res.ok) return { error: res.error };

  // Pago confirmado = Subscribe para Meta, por la API de conversiones (el porqué, en
  // conversionesMeta.ts). Una vez por cobro: cada cobro pagado nace UNA vez acá, y el `event_id` sale
  // del id del cobro, así que un reintento Meta lo descarta. Con `after` para que FM no espere a Meta,
  // y sin poder fallar: notificarPagoAMeta no lanza. Un cobro pendiente no avisa nada.
  if (estadoCobro === 'pagado') {
    after(() => notificarPagoAMeta(supabase, { cuentaId, cobroId: res.id, monto }));
  }

  revalidatePath(`/admin/cuentas/${cuentaId}`);
  return { ok: true };
}

export type EstadoMarcado = { error: string } | { ok: string } | undefined;

// FM marca pagado un cobro de la app que cobró por fuera de Wompi (o cuyo webhook no llegó). Pasa por la
// misma puerta que el webhook (`confirmarPagoCobro`): aplica el plan, activa la licencia y avisa a Meta
// una vez. El cobro se lee ACOTADO a esta cuenta: conocer el id de un cobro ajeno no basta.
export async function accionMarcarCobroPagado(
  cuentaId: string,
  cobroId: string,
  _estadoPrevio: EstadoMarcado,
  _formData: FormData,
): Promise<EstadoMarcado> {
  await verifyFmAdmin();

  const supabase = createServiceClient();
  let cobro;
  try {
    cobro = await obtenerCobroParaPagoDeLaCuenta(supabase, cuentaId, cobroId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'No se pudo leer el cobro.' };
  }
  if (!cobro) return { error: 'No encontramos ese cobro en esta cuenta. Recargá la página.' };

  const r = await marcarCobroPagadoAMano(dependenciasResolver(supabase), cobro);
  if (!r.ok) return { error: r.error };

  // Cambió el plan de la cuenta (lo lee todo /comercio) y el contador de pagos de la nav de /admin.
  revalidatePath('/admin', 'layout');
  revalidatePath('/comercio', 'layout');
  return { ok: r.mensaje };
}

// FM le pide un pago al cliente cuando quiera (spec cobranza, "Acciones de FM" #4): el monto y el plan
// los elige FM a mano, así que el monto puede NO coincidir con ningún plan del catálogo (sirve para
// probar con $1). El dueño lo paga después con accionPagarCobro (plan/actions.ts) cuando toca «Pagar».
export async function accionPedirPago(
  cuentaId: string,
  _estadoPrevio: EstadoCobro,
  formData: FormData,
): Promise<EstadoCobro> {
  await verifyFmAdmin();

  const planRaw = String(formData.get('plan') ?? '').trim();
  const res = await pedirPago(createServiceClient(), cuentaId, {
    monto: Number(String(formData.get('monto') ?? '').trim()),
    plan: planRaw === '' ? null : planRaw,
    periodoDesde: String(formData.get('periodo_desde') ?? ''),
    periodoHasta: String(formData.get('periodo_hasta') ?? ''),
  });
  if (!res.ok) return { error: res.error };

  revalidatePath(`/admin/cuentas/${cuentaId}`);
  return { ok: true };
}

// Anular un cobro pendiente, de cualquier tipo (spec cobranza, "Acciones de FM" #5). Se lee primero
// ACOTADO a la cuenta (obtenerCobro) para confirmar que existe y es de esta cuenta ANTES de anularlo: un
// id ajeno no debe poder tocar el cobro de otro cliente. `anularCobroPendiente` ya solo anula si el
// estado sigue 'pendiente' (no hace falta repetir ese chequeo acá).
export async function accionAnularCobro(
  cuentaId: string,
  cobroId: string,
  _estadoPrevio: EstadoCobro,
  _formData: FormData,
): Promise<EstadoCobro> {
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const cobro = await obtenerCobro(supabase, cuentaId, cobroId);
  if (!cobro) return { error: 'No encontramos ese cobro en esta cuenta. Recargá la página.' };

  await anularCobroPendiente(supabase, cobroId);

  revalidatePath(`/admin/cuentas/${cuentaId}`);
  return { ok: true };
}
