import { ErrorWompi, type ClienteWompi } from '../wompi/cliente';
import { hashRedirectValido } from '../wompi/firma';
import {
  confirmarPagoCobro,
  type CobroParaPago,
  type Conciliacion,
  type RepositorioPagos,
} from './confirmarPago';

// La página a la que Wompi devuelve al dueño después de pagar (spec 2026-09-21-pasarela-wompi-design.md,
// "Confirmar sin depender solo del webhook"). Es el camino de RESPALDO: el principal es el webhook, pero
// como el plan solo cambia al confirmarse el pago, el dueño no puede quedar esperando a que llegue.
//
// La verdad es la CONSULTA A LA API de Wompi, no los parámetros de la URL: cualquiera puede escribir una
// URL. Lo que hace segura la confirmación es la suma de tres cosas: (1) la API dice que la transacción
// existe, es real y está aprobada; (2) el cobro es de la CUENTA DE LA SESIÓN, no uno cualquiera; (3) una
// transacción paga como máximo un cobro (índice único). El hash del redirect sería una cuarta capa, pero
// la doc de Wompi se contradice sobre cómo se calcula para los enlaces, así que NO es bloqueante: una
// diferencia se registra como advertencia y se sigue con la API.

export type ResultadoRetorno =
  | { estado: 'confirmado' } // el pago quedó aplicado (o ya lo estaba)
  | { estado: 'confirmando' } // Wompi todavía no refleja la transacción: la página se recarga sola
  | { estado: 'prueba' } // un pago de prueba: no cambia el plan
  | { estado: 'rechazado' } // Wompi dice que no se aprobó
  | { estado: 'revision' } // se recibió, pero hay algo que FM tiene que mirar
  | { estado: 'invalido' }; // parámetros que no corresponden a un cobro de esta cuenta

export interface ParametrosRetorno {
  identificadorEnlaceComercio?: string | null;
  idTransaccion?: string | null;
  idEnlace?: string | null;
  monto?: string | null;
  hash?: string | null;
}

export interface DepsRetorno {
  repo: RepositorioPagos;
  wompi: Pick<ClienteWompi, 'consultarTransaccion'>;
  // El cobro SOLO si es de esta cuenta (mismo patrón que `obtenerCobro` de cobros.ts).
  obtenerCobroDeLaCuenta(cuentaId: string, cobroId: string): Promise<CobroParaPago | null>;
  secreto: string;
  aceptarPruebas: boolean;
  hoy: string;
  alReclamar?: (cobro: CobroParaPago) => void;
  advertir: (mensaje: string) => void;
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POR_CONCILIACION: Record<Conciliacion, ResultadoRetorno['estado']> = {
  aplicado: 'confirmado',
  prueba: 'prueba',
  no_aprobada: 'rechazado',
  // Todo lo demás: el pago llegó, pero necesita que FM decida.
  pendiente: 'revision',
  sin_cobro: 'revision',
  cobro_anulado: 'revision',
  monto_distinto: 'revision',
  ya_pagado: 'revision',
  plan_no_aplicable: 'revision',
  error: 'revision',
};

export async function confirmarDesdeRetorno(
  deps: DepsRetorno,
  cuentaId: string,
  params: ParametrosRetorno,
): Promise<ResultadoRetorno> {
  const identificador = params.identificadorEnlaceComercio?.trim() ?? '';
  const idTransaccion = params.idTransaccion?.trim() ?? '';
  if (!ES_UUID.test(identificador) || idTransaccion === '') return { estado: 'invalido' };

  const cobro = await deps.obtenerCobroDeLaCuenta(cuentaId, identificador);
  if (cobro === null) return { estado: 'invalido' };

  if (params.idEnlace && params.monto && params.hash) {
    const coincide = hashRedirectValido(
      {
        identificadorEnlaceComercio: identificador,
        idTransaccion,
        idEnlace: params.idEnlace,
        monto: params.monto,
        hash: params.hash,
      },
      deps.secreto,
    );
    if (!coincide) {
      deps.advertir(
        'El hash del redirect de Wompi no coincide con la variante de 4 campos; se confirma con la API. Revisar la spec ("A verificar", punto 3).',
      );
    }
  }

  // El webhook ya lo aplicó.
  if (cobro.estado === 'pagado') return { estado: 'confirmado' };

  let transaccion;
  try {
    transaccion = await deps.wompi.consultarTransaccion(idTransaccion);
  } catch (error) {
    // 404 = todavía no la refleja; cualquier otra falla (red, credenciales) también deja al dueño en
    // "confirmando": el webhook puede completarlo, y FM ve el estado en /admin/pagos.
    if (!(error instanceof ErrorWompi) || error.estado !== 404) {
      deps.advertir(`No se pudo consultar la transacción en Wompi: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { estado: 'confirmando' };
  }
  if (transaccion.idTransaccion !== idTransaccion) return { estado: 'invalido' };

  try {
    const resultado = await confirmarPagoCobro(
      deps.repo,
      {
        fuente: 'redirect',
        idTransaccion,
        monto: transaccion.monto,
        esReal: transaccion.esReal,
        aprobada: transaccion.esAprobada,
        // El identificador YA está verificado contra la sesión: es el id de un cobro de esta cuenta.
        identificadorEnlace: cobro.id,
        fecha: transaccion.fecha,
        payload: transaccion,
      },
      { aceptarPruebas: deps.aceptarPruebas, hoy: deps.hoy, alReclamar: deps.alReclamar },
    );
    return { estado: POR_CONCILIACION[resultado.conciliacion] };
  } catch (error) {
    deps.advertir(`Falló al aplicar el pago desde el redirect: ${error instanceof Error ? error.message : String(error)}`);
    return { estado: 'confirmando' };
  }
}
