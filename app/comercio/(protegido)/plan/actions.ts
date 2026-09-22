'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { verifyComercioOwnerSinBloqueo } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { baseUrlDeLaApp, iniciarPagoPlanDelDueno } from '@/lib/comercios/iniciarPagoPlanSupabase';
import { pagarCobroPedido } from '@/lib/comercios/accionPagarCobro';
import { clienteWompi } from '@/lib/wompi/cliente';
import type { AccionPago } from '@/lib/comercios/opcionesPago';
import { solicitarCambioPlan } from '@/lib/comercios/planCuenta';

export type EstadoSolicitudPlan = { error: string } | { ok: true } | undefined;

// La cuenta se deriva del comercio del gate, NUNCA de un campo del formulario: si viniera del
// cliente, un dueño podría pedir un cambio de plan sobre la cuenta de otro.
export async function cuentaDelComercio(comercioId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('comercios')
    .select('cuenta_id')
    .eq('id', comercioId)
    .maybeSingle();
  return data?.cuenta_id ?? null;
}

export async function accionSolicitarPlan(
  _estadoPrevio: EstadoSolicitudPlan,
  formData: FormData,
): Promise<EstadoSolicitudPlan> {
  // SIN bloqueo (spec cobranza "Cómo se bloquea", Tarea 5 — hallazgo agregado al alcance durante la
  // implementación): esta acción vive solo en /comercio/plan, la página exceptuada. Con
  // verifyComercioOwner() (que SÍ bloquea) un dueño bloqueado viendo ?suspendida=1 perdería también
  // la posibilidad de pedir un cambio de plan sin ganar acceso a ningún otro rincón del panel.
  const { comercioId } = await verifyComercioOwnerSinBloqueo();

  const cuentaId = await cuentaDelComercio(comercioId);
  if (!cuentaId) return { error: 'Tu comercio todavía no está asociado a una cuenta.' };

  const res = await solicitarCambioPlan(
    createServiceClient(),
    cuentaId,
    String(formData.get('plan') ?? ''),
    String(formData.get('motivo') ?? ''),
  );
  if (!res.ok) return { error: res.error };

  revalidatePath('/comercio/plan');
  return { ok: true };
}

// Iniciar un pago del plan: elegir, subir o renovar. Crea el cobro y el enlace de Wompi y lleva al dueño a
// la pantalla de pago. El plan NO cambia acá: cambia cuando Wompi confirma el pago (webhook, o la página
// de vuelta), ver lib/comercios/confirmarPago.ts.
//
// El formulario manda SOLO el plan y la acción. El importe, el período y si la opción está disponible los
// decide el servidor (lib/comercios/opcionesPago.ts): un monto que viniera del navegador dejaría que
// cualquiera pagara $0.01 por un plan de $89. Y la cuenta se deriva del comercio del gate, nunca del
// formulario.
export type EstadoPagoPlan = { error: string } | undefined;

const ACCIONES: readonly AccionPago[] = ['activar', 'cambiar', 'renovar'];

export async function accionIniciarPago(
  _estadoPrevio: EstadoPagoPlan,
  formData: FormData,
): Promise<EstadoPagoPlan> {
  // OJO: verifyComercioOwnerSinBloqueo() y redirect() funcionan LANZANDO. Nunca los envuelvas en
  // try/catch. SIN bloqueo a propósito (spec cobranza "Cómo se bloquea", Tarea 5 — hallazgo
  // agregado al alcance durante la implementación): esta es la acción real detrás del botón de
  // pago de /comercio/plan (OpcionesDePago.tsx), la página exceptuada a la que el gate manda a un
  // dueño `bloqueada` con `?suspendida=1`. Si usara verifyComercioOwner() (que SÍ bloquea), ese
  // mismo dueño volvería a rebotar acá al tocar "Pagar" — sin crear el enlace de Wompi, sin forma
  // de autodesbloquearse.
  const { comercioId } = await verifyComercioOwnerSinBloqueo();

  const cuentaId = await cuentaDelComercio(comercioId);
  if (!cuentaId) return { error: 'Tu comercio todavía no está asociado a una cuenta.' };

  const accion = ACCIONES.find((a) => a === String(formData.get('accion') ?? ''));
  if (accion === undefined) return { error: 'Esa opción no es válida. Recargá la página.' };

  let resultado;
  try {
    resultado = await iniciarPagoPlanDelDueno(cuentaId, String(formData.get('plan') ?? ''), accion);
  } catch (error) {
    // Falta configuración (variables de Wompi, URL base) o se cayó algo inesperado: el dueño no necesita el detalle.
    console.error('[pagos] no se pudo iniciar el pago:', error);
    return { error: 'No pudimos iniciar el pago. Probá de nuevo en un rato.' };
  }
  if (!resultado.ok) return { error: resultado.error };

  // Fuera del try: redirect() lanza NEXT_REDIRECT (en una acción de servidor responde 303 a la URL de Wompi).
  redirect(resultado.url);
}

// El dueño paga un cobro que FM le pidió (spec cobranza, "Pedir un pago al cliente: cómo lo paga el
// dueño"). Solo recibe el id del cobro: `pagarCobroPedido` lo acota a la cuenta que sale del gate (nunca
// del formulario), y rechaza cualquiera que no sea `Pedido por FM`, ya pagado, o de otra cuenta.
export type EstadoPagarCobro = { error: string } | undefined;

export async function accionPagarCobro(
  cobroId: string,
  _estadoPrevio: EstadoPagarCobro,
  _formData: FormData,
): Promise<EstadoPagarCobro> {
  // OJO: verifyComercioOwnerSinBloqueo() y redirect() funcionan LANZANDO. Nunca los envuelvas en
  // try/catch. SIN bloqueo a propósito (spec cobranza "Cómo se bloquea", Tarea 5 — hallazgo
  // agregado al alcance durante la implementación): un cobro "Pedido por FM" puede ser justo el
  // pago que reactiva una cuenta `bloqueada`, y esta acción vive solo en /comercio/plan (la página
  // exceptuada). Con verifyComercioOwner() (que SÍ bloquea) un dueño bloqueado no podría pagarlo.
  const { comercioId } = await verifyComercioOwnerSinBloqueo();

  const cuentaId = await cuentaDelComercio(comercioId);
  if (!cuentaId) return { error: 'Tu comercio todavía no está asociado a una cuenta.' };

  let resultado;
  try {
    resultado = await pagarCobroPedido(createServiceClient(), cuentaId, cobroId, {
      wompi: clienteWompi(),
      ahora: () => new Date(),
      baseUrl: baseUrlDeLaApp(),
    });
  } catch (error) {
    // Falta configuración (variables de Wompi, URL base) o se cayó algo inesperado: el dueño no necesita el detalle.
    console.error('[pagos] no se pudo procesar el pago del cobro pedido por FM:', error);
    return { error: 'No pudimos iniciar el pago. Probá de nuevo en un rato.' };
  }
  if (!resultado.ok) return { error: resultado.error };

  // Fuera del try: redirect() lanza NEXT_REDIRECT.
  redirect(resultado.url);
}
