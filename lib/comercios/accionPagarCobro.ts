import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { ClienteWompi } from '../wompi/cliente';
import { METODO_PEDIDO_FM, guardarEnlaceDelCobro, obtenerCobroPedidoParaPagar } from './cobros';
import { VIGENCIA_ENLACE_MS } from './iniciarPagoPlan';

// El DUEÑO paga un cobro que FM le pidió (spec 2026-09-21-cobranza-design.md, "Pedir un pago al cliente:
// cómo lo paga el dueño"). El cobro de FM NO se crea con enlace: el enlace de Wompi dura 2 horas y el
// dueño puede tardar días en tocar «Pagar». El enlace se crea ACÁ, cuando lo toca.
//
// Si ya tiene un enlace vigente lo reusa; si no, crea uno nuevo con el MISMO `identificador` (id del
// cobro) — spike confirmado (spec): Wompi acepta el mismo identificador más de una vez, así que no hace
// falta anular ni editar nada antes.
//
// Las dependencias de Wompi y del reloj entran por parámetro para probar sin red, igual que
// iniciarPagoPlan.ts; `supabase` entra directo (sin repositorio intermedio) porque acá no hay opciones
// que calcular, solo leer un cobro y guardar un enlace.

export type ResultadoPagarCobro = { ok: true; url: string } | { ok: false; error: string };

export interface DepsPagarCobro {
  wompi: Pick<ClienteWompi, 'crearEnlacePago'>;
  ahora: () => Date;
  // `https://www.cardly-sv.site`, sin barra final.
  baseUrl: string;
}

const ERROR_ENLACE = 'No pudimos generar el enlace de pago. Probá de nuevo en un rato.';

export async function pagarCobroPedido(
  supabase: SupabaseClient<Database>,
  cuentaId: string,
  cobroId: string,
  deps: DepsPagarCobro,
): Promise<ResultadoPagarCobro> {
  const cobro = await obtenerCobroPedidoParaPagar(supabase, cuentaId, cobroId);
  if (cobro === null) {
    return { ok: false, error: 'No encontramos ese cobro en tu cuenta. Recargá la página.' };
  }
  if (cobro.metodo !== METODO_PEDIDO_FM) {
    return { ok: false, error: 'Ese cobro no es uno que Cardly SV te haya pedido.' };
  }
  if (cobro.estado !== 'pendiente') {
    return { ok: false, error: 'Ese cobro ya no está pendiente.' };
  }

  const ahora = deps.ahora();
  const enlaceVigente =
    cobro.wompiUrlEnlace !== null &&
    cobro.wompiEnlaceVence !== null &&
    new Date(cobro.wompiEnlaceVence).getTime() > ahora.getTime();
  if (enlaceVigente) {
    return { ok: true, url: cobro.wompiUrlEnlace as string };
  }

  const venceEn = new Date(ahora.getTime() + VIGENCIA_ENLACE_MS);
  try {
    const enlace = await deps.wompi.crearEnlacePago({
      identificador: cobro.id,
      monto: cobro.monto,
      nombreProducto: 'Cardly SV · Cobro solicitado',
      descripcion: 'Pago solicitado por Cardly SV.',
      urlRedirect: `${deps.baseUrl}/comercio/plan/pago/resultado`,
      urlRetorno: `${deps.baseUrl}/comercio/plan`,
      urlWebhook: `${deps.baseUrl}/api/wompi/webhook`,
      ahora,
      venceEn,
      datosAdicionales: { cobro: cobro.id, cuenta: cuentaId },
    });
    await guardarEnlaceDelCobro(supabase, cobro.id, {
      idEnlace: enlace.idEnlace,
      url: enlace.urlEnlace,
      vence: venceEn.toISOString(),
    });
    return { ok: true, url: enlace.urlEnlace };
  } catch (error) {
    console.error('[pagos] no se pudo crear el enlace del cobro solicitado por Cardly SV:', error);
    return { ok: false, error: ERROR_ENLACE };
  }
}
