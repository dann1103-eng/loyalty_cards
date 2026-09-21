import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/types';
import { obtenerCobroParaPago, reclamarCobroPagado } from './cobros';
import { aConciliacion, type RepositorioPagos } from './confirmarPago';
import { activarLicencia, aplicarPlanDestino } from './planCuenta';

// El adaptador REAL de `RepositorioPagos` (confirmarPago.ts) sobre Supabase. La lógica vive en
// `confirmarPagoCobro`; esto solo traduce cada operación a la base. Su contrato lo comparte
// test/fixtures/repositorioPagosFalso.ts, y `repositorioPagosSupabase.test.ts` corre los mismos casos
// contra la base: si el falso y este se desvían, las pruebas de la lógica se vuelven decorativas.

// El cuerpo de un pago viene de un JSON.parse (o de la respuesta de la API de Wompi), o sea que ya es
// JSON; pasarlo por stringify/parse lo GARANTIZA (sin `undefined`, sin fechas, sin funciones) antes de
// afirmarle a TypeScript que es `Json`. El cuerpo trae nombre y correo del pagador: lo lee solo el admin.
function aJson(valor: unknown): Json {
  return JSON.parse(JSON.stringify(valor ?? null)) as Json;
}

export function repositorioPagosSupabase(supabase: SupabaseClient<Database>): RepositorioPagos {
  return {
    obtenerCobro: (id) => obtenerCobroParaPago(supabase, id),

    async registrarEvento(evento) {
      const { data, error } = await supabase
        .from('pagos_wompi')
        .insert({
          id_transaccion: evento.idTransaccion,
          fuente: evento.fuente,
          identificador_enlace: evento.identificadorEnlace,
          monto: evento.monto,
          es_real: evento.esReal,
          fecha_transaccion: evento.fecha,
          conciliacion: evento.conciliacion ?? 'pendiente',
          detalle: evento.detalle ?? null,
          payload: aJson(evento.payload),
        })
        .select('id, conciliacion')
        .single();
      if (!error && data) return { id: data.id, conciliacion: aConciliacion(data.conciliacion) };

      // 23505 = ya existía un evento de esa transacción (el índice único): es la idempotencia, no un fallo.
      if (error?.code !== '23505') {
        throw new Error(`No se pudo registrar el evento de pago: ${error?.message ?? 'sin detalle'}`);
      }
      const { data: previo, error: eLeer } = await supabase
        .from('pagos_wompi')
        .select('id, conciliacion, fuente')
        .eq('id_transaccion', evento.idTransaccion)
        .single();
      if (eLeer || !previo) {
        throw new Error(`No se pudo leer el evento de pago existente: ${eLeer?.message ?? 'sin detalle'}`);
      }

      // Si el evento que había vino del REDIRECT (su cuerpo es la respuesta de la API) y ahora llega el
      // webhook, se guarda el cuerpo REAL del webhook: es el que hace falta para diagnosticar el formato.
      if (evento.fuente === 'webhook' && previo.fuente === 'redirect') {
        const { error: eCuerpo } = await supabase
          .from('pagos_wompi')
          .update({ fuente: 'webhook', payload: aJson(evento.payload) })
          .eq('id', previo.id);
        if (eCuerpo) console.error('[wompi] no se pudo guardar el cuerpo del webhook:', eCuerpo);
      }
      return { id: previo.id, conciliacion: aConciliacion(previo.conciliacion) };
    },

    async actualizarEvento(id, cambios) {
      const actualizar: Database['public']['Tables']['pagos_wompi']['Update'] = {
        conciliacion: cambios.conciliacion,
      };
      // Un campo `undefined` NO se toca: sin esto, marcar un evento en error después de haberle
      // asignado su cobro le borraría el cobro.
      if (cambios.detalle !== undefined) actualizar.detalle = cambios.detalle;
      if (cambios.cobroId !== undefined) actualizar.cobro_id = cambios.cobroId;
      if (cambios.cuentaId !== undefined) actualizar.cuenta_id = cambios.cuentaId;

      const { error } = await supabase.from('pagos_wompi').update(actualizar).eq('id', id);
      if (error) throw new Error(`No se pudo actualizar el evento de pago: ${error.message}`);
    },

    aplicarPlan: (cuentaId, plan, tipo) => aplicarPlanDestino(supabase, cuentaId, plan, tipo),
    activarLicencia: (cuentaId, hoy) => activarLicencia(supabase, cuentaId, hoy),
    reclamarCobro: (cobroId, datos) => reclamarCobroPagado(supabase, cobroId, datos),
  };
}
