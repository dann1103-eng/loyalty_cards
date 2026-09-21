import { createHash } from 'node:crypto';
import {
  confirmarPagoCobro,
  type CobroParaPago,
  type Conciliacion,
  type RepositorioPagos,
} from '../comercios/confirmarPago';
import { firmaValida } from './firma';
import { decodificarCuerpo, estaAprobado, parsearWebhook } from './webhook';

// La lógica de POST /api/wompi/webhook, sin Next: la ruta solo lee la request y devuelve esto. Así se
// prueba entera (firma, cuerpo irreconocible, errores) con un repositorio falso.
//
// Códigos de respuesta, y por qué:
//   401  firma inválida o ausente. Nada se guarda: cualquiera puede mandar un POST a una URL pública.
//   200  todo lo demás que Wompi no arreglaría reintentando: procesado, ya procesado, prueba, sin cobro,
//        cuerpo irreconocible. Un 200 le dice a Wompi "listo, no insistas".
//   500  una falla interna (la base). Wompi reintenta, y el reintento es idempotente.

export interface EntradaWebhook {
  // Los BYTES del cuerpo tal cual llegaron: la firma se calcula sobre ellos.
  cuerpo: Uint8Array;
  firma: string | null;
  secreto: string;
  aceptarPruebas: boolean;
  hoy: string;
  alReclamar?: (cobro: CobroParaPago) => void;
}

export interface RespuestaWebhook {
  estado: 200 | 401 | 500;
  cuerpo: { ok: boolean; conciliacion?: Conciliacion; error?: string };
}

export async function procesarWebhook(
  repo: RepositorioPagos,
  entrada: EntradaWebhook,
): Promise<RespuestaWebhook> {
  if (!firmaValida(entrada.firma, entrada.cuerpo, entrada.secreto)) {
    return { estado: 401, cuerpo: { ok: false, error: 'Firma inválida' } };
  }

  const texto = decodificarCuerpo(entrada.cuerpo);
  let json: unknown;
  let motivo: string | null = null;
  try {
    json = JSON.parse(texto);
  } catch {
    motivo = 'el cuerpo no es JSON';
  }
  const parseo = motivo === null ? parsearWebhook(json) : { ok: false as const, motivo };

  if (!parseo.ok) {
    // La firma es válida, así que ES de Wompi y probablemente un pago real con un formato que no
    // esperábamos. Se guarda el cuerpo crudo con un id sintético (la misma huella para el mismo cuerpo,
    // así un reintento no lo duplica) y se responde 200: un reintento infinito no arregla un parser.
    const huella = createHash('sha256').update(entrada.cuerpo).digest('hex').slice(0, 24);
    try {
      await repo.registrarEvento({
        idTransaccion: `sin-id-${huella}`,
        fuente: 'webhook',
        identificadorEnlace: null,
        monto: 0,
        esReal: false,
        fecha: null,
        payload: json ?? { cuerpoCrudo: texto.slice(0, 4000) },
        conciliacion: 'error',
        detalle: `Cuerpo no reconocido: ${parseo.motivo}`,
      });
    } catch (error) {
      console.error('[wompi] no se pudo guardar un webhook irreconocible:', error);
      return { estado: 500, cuerpo: { ok: false, error: 'No se pudo guardar' } };
    }
    console.error('[wompi] webhook con firma válida y cuerpo irreconocible:', parseo.motivo);
    return { estado: 200, cuerpo: { ok: true, conciliacion: 'error' } };
  }

  const pago = parseo.pago;
  try {
    const resultado = await confirmarPagoCobro(
      repo,
      {
        fuente: 'webhook',
        idTransaccion: pago.idTransaccion,
        monto: pago.monto,
        esReal: pago.esProductiva,
        aprobada: estaAprobado(pago),
        identificadorEnlace: pago.identificadorEnlace,
        fecha: pago.fecha,
        payload: json,
      },
      { aceptarPruebas: entrada.aceptarPruebas, hoy: entrada.hoy, alReclamar: entrada.alReclamar },
    );
    return { estado: 200, cuerpo: { ok: true, conciliacion: resultado.conciliacion } };
  } catch (error) {
    console.error('[wompi] falló al procesar el webhook:', error);
    return { estado: 500, cuerpo: { ok: false, error: 'Falla interna' } };
  }
}
