import 'server-only';

import { after } from 'next/server';
import { notificarPagoAMeta } from '../marketing/conversionesMeta';
import { createServiceClient } from '../supabase/server';
import { hoyEnZona } from '../tarjetas/vigencia';
import { clienteWompi } from '../wompi/cliente';
import { leerConfigWompi, type ConfigWompi } from '../wompi/config';
import { obtenerCobroParaPagoDeLaCuenta } from './cobros';
import { confirmarDesdeRetorno, type ParametrosRetorno, type ResultadoRetorno } from './confirmarPorRedirect';
import { repositorioPagosSupabase } from './repositorioPagosSupabase';

// El cableado REAL de la página de vuelta del dueño (confirmarPorRedirect.ts): la base, la API de Wompi y
// el aviso a Meta. La página (app/comercio/(protegido)/plan/pago/resultado/page.tsx) solo lo llama.
export async function confirmarRetornoDelDueno(
  cuentaId: string,
  params: ParametrosRetorno,
): Promise<ResultadoRetorno> {
  let config: ConfigWompi;
  try {
    config = leerConfigWompi();
  } catch (error) {
    // Sin credenciales no se puede confirmar. El dueño ve "confirmando" y el log dice por qué.
    console.error('[wompi] no se pudo confirmar el retorno, falta configuración:', error instanceof Error ? error.message : error);
    return { estado: 'confirmando' };
  }

  const supabase = createServiceClient();
  return confirmarDesdeRetorno(
    {
      repo: repositorioPagosSupabase(supabase),
      wompi: clienteWompi(),
      obtenerCobroDeLaCuenta: (cuenta, cobro) => obtenerCobroParaPagoDeLaCuenta(supabase, cuenta, cobro),
      secreto: config.clientSecret,
      aceptarPruebas: config.aceptarPruebas,
      hoy: hoyEnZona(null),
      alReclamar: (cobro) =>
        after(() => notificarPagoAMeta(supabase, { cuentaId: cobro.cuentaId, cobroId: cobro.id, monto: cobro.monto })),
      advertir: (mensaje) => console.warn(`[wompi] ${mensaje}`),
    },
    cuentaId,
    params,
  );
}
