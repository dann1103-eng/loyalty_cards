'use server';

import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { marcarRevisado, necesitaAtencion, obtenerPago } from '@/lib/comercios/pagosAdmin';
import { aplicarPagoAMano, reintentarPago } from '@/lib/comercios/resolverPagos';
import { dependenciasResolver } from '@/lib/comercios/resolverPagosSupabase';

export type EstadoPago = { error: string } | { ok: string } | undefined;

// Una sola acción para los tres botones de un pago: cada botón manda `accion` en el formulario. Con un
// estado único, el mensaje que se ve es siempre el de la ÚLTIMA cosa que hizo FM (con tres estados
// separados, un error viejo taparía un resultado nuevo).
//
// NO valida reglas de negocio: relee el evento de la base (no se fía de lo que manda la pantalla) y
// delega en lib/comercios/resolverPagos.ts, que revalida que la acción corresponda al estado del evento.
// Aquí solo: autenticar, leer, delegar, refrescar pantallas.
export async function accionResolverPago(
  eventoId: string,
  _estadoPrevio: EstadoPago,
  formData: FormData,
): Promise<EstadoPago> {
  // OJO: verifyFmAdmin() usa redirect(), que funciona LANZANDO. Nunca lo envuelvas en try/catch.
  await verifyFmAdmin();

  const accion = String(formData.get('accion') ?? '');
  if (accion !== 'reintentar' && accion !== 'aplicar' && accion !== 'revisado') {
    return { error: 'Acción desconocida.' };
  }

  const supabase = createServiceClient();
  const evento = await obtenerPago(supabase, eventoId);
  if (!evento) return { error: 'No encontramos ese pago. Recargá la página.' };

  if (accion === 'revisado') {
    if (!necesitaAtencion(evento)) return { error: 'Este pago ya no necesita atención.' };
    try {
      await marcarRevisado(supabase, eventoId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'No se pudo marcar como revisado.' };
    }
    revalidatePath('/admin', 'layout');
    return { ok: 'Marcado como revisado.' };
  }

  const deps = dependenciasResolver(supabase);
  const r = accion === 'reintentar' ? await reintentarPago(deps, evento) : await aplicarPagoAMano(deps, evento);
  if (!r.ok) return { error: r.error };

  // Un pago aplicado cambia el plan de la cuenta (lo lee todo /comercio); el contador de la nav de /admin
  // cambia en cualquier caso.
  revalidatePath('/admin', 'layout');
  if (r.conciliacion === 'aplicado' || r.conciliacion === 'plan_no_aplicable') {
    revalidatePath('/comercio', 'layout');
  }
  return { ok: r.mensaje };
}
