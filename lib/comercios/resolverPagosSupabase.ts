import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notificarPagoAMeta } from '../marketing/conversionesMeta';
import type { Database } from '../supabase/types';
import { hoyEnZona } from '../tarjetas/vigencia';
import { pruebasAceptadas } from '../wompi/config';
import { marcarRevisado } from './pagosAdmin';
import { repositorioPagosSupabase } from './repositorioPagosSupabase';
import type { DependenciasResolver } from './resolverPagos';

// Las dependencias REALES de `resolverPagos.ts` para las acciones de servidor de FM: el repositorio de
// Supabase, el día de hoy en El Salvador y el aviso a Meta. Es pegamento, sin lógica: la lógica y sus
// pruebas viven en resolverPagos.ts.
//
// Se llama desde una Server Action (`after` solo funciona dentro de una request de Next). El aviso a Meta
// sale UNA vez por cobro de período, cuando esta operación fue la que reclamó el cobro, y no puede fallar:
// `notificarPagoAMeta` no lanza.
export function dependenciasResolver(supabase: SupabaseClient<Database>): DependenciasResolver {
  return {
    repo: repositorioPagosSupabase(supabase),
    hoy: hoyEnZona(null),
    aceptarPruebas: pruebasAceptadas(process.env),
    alReclamar: (cobro) =>
      after(() => notificarPagoAMeta(supabase, { cuentaId: cobro.cuentaId, cobroId: cobro.id, monto: cobro.monto })),
    marcarRevisado: (eventoId, detalle) => marcarRevisado(supabase, eventoId, detalle),
  };
}
