import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { idPixelValido } from './pixelMeta';

// Subscribe de Meta por la API de conversiones, DEL LADO DEL SERVIDOR (2026-09-13).
//
// ══ POR QUÉ NO VA EN EL PÍXEL ══ Cardly no tiene pasarela de pago: el dueño no ve ninguna pantalla
// de "pago confirmado". El pago lo confirma FM a mano, al registrar el cobro como `pagado` en
// /admin/cuentas/[id]. Un píxel en ese momento correría en el navegador de FM (la conversión
// quedaría atribuida a quien lo registra, no al cliente), y uno en el panel del dueño rompería la
// regla de no cargar el píxel ahí. Elegido por el dueño del producto entre esas opciones.
//
// ══ QUÉ VIAJA A META ══ Solo el evento, el monto en USD y el correo del dueño de la cuenta CIFRADO
// con SHA-256: sin un dato de la persona Meta no puede asociar el pago a nadie. Nada del negocio,
// de sus clientes ni del cobro en claro (el `event_id` también va cifrado).

// Versión de la Graph API que muestran los ejemplos oficiales al 2026-09-13. Meta mantiene cada
// versión unos dos años; cuando esta caduque, la respuesta del envío empieza a ser un error y queda
// escrito en el log ("[meta] Subscribe rechazado").
export const VERSION_API_META = 'v25.0';

export function hashCorreo(correo: string): string | null {
  const normalizado = correo.trim().toLowerCase();
  return normalizado ? createHash('sha256').update(normalizado).digest('hex') : null;
}

// Determinístico por cobro: si el mismo envío se reintenta, Meta lo descarta como duplicado.
// Cifrado porque el id del cobro es un identificador interno del sistema.
export function idEventoSubscribe(cobroId: string): string {
  return createHash('sha256').update(`cardly:Subscribe:${cobroId}`).digest('hex');
}

export interface DatosSubscribe {
  cobroId: string;
  monto: number;
  correos: string[];
  ahora: Date;
}

export interface CuerpoEventosMeta {
  data: Array<{
    event_name: 'Subscribe';
    event_time: number;
    action_source: 'system_generated';
    event_id: string;
    user_data: { em: string[] };
    custom_data: { value: number; currency: 'USD' };
  }>;
  test_event_code?: string;
}

export function construirEventoSubscribe(
  datos: DatosSubscribe,
  codigoPrueba?: string,
): CuerpoEventosMeta | null {
  // Un cobro en $0 (un mes regalado) no es un pago, y Meta optimizaría los anuncios hacia él.
  if (!Number.isFinite(datos.monto) || datos.monto <= 0) return null;

  const hashes = [...new Set(datos.correos.map(hashCorreo).filter((h): h is string => h !== null))];
  if (hashes.length === 0) return null;

  return {
    data: [
      {
        event_name: 'Subscribe',
        // La hora del ENVÍO, no la fecha de pago que escribió FM: Meta rechaza la petición entera si
        // `event_time` tiene más de 7 días, y un pago se puede registrar semanas después.
        event_time: Math.floor(datos.ahora.getTime() / 1000),
        // No `website`: ese origen exige la URL y el navegador de quien convirtió, y acá la
        // conversión la registra un sistema, no una visita.
        action_source: 'system_generated',
        event_id: idEventoSubscribe(datos.cobroId),
        user_data: { em: hashes },
        custom_data: { value: datos.monto, currency: 'USD' },
      },
    ],
    ...(codigoPrueba ? { test_event_code: codigoPrueba } : {}),
  };
}

export interface EntornoConversiones {
  token?: string;
  idPixel?: string;
  // META_CAPI_TEST_EVENT_CODE: con esto el evento aparece en "Probar eventos" del Administrador de
  // eventos y NO cuenta para los anuncios. Para validar; se borra al terminar.
  codigoPrueba?: string;
}

export type ResultadoEnvio = 'enviado' | 'sin-configurar' | 'sin-datos' | 'error';

export async function enviarSubscribe(
  datos: DatosSubscribe,
  entorno: EntornoConversiones,
  fetchFn: typeof fetch = fetch,
): Promise<ResultadoEnvio> {
  const idPixel = idPixelValido(entorno.idPixel);
  const token = entorno.token?.trim();
  if (!idPixel || !token) return 'sin-configurar';

  const cuerpo = construirEventoSubscribe(datos, entorno.codigoPrueba?.trim() || undefined);
  if (!cuerpo) return 'sin-datos';

  // El token va en la URL porque así lo documenta Meta. Por eso la URL NUNCA se escribe al log.
  const url = `https://graph.facebook.com/${VERSION_API_META}/${idPixel}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const respuesta = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    if (!respuesta.ok) {
      // El cuerpo de error de Meta explica la causa (token vencido, versión caducada) y no trae el
      // token. Recortado por si acaso llega algo enorme.
      const detalle = (await respuesta.text().catch(() => '')).slice(0, 500);
      console.error('[meta] Subscribe rechazado:', respuesta.status, detalle);
      return 'error';
    }
    // El éxito TAMBIÉN queda en el log (2026-09-16). La primera prueba real no mostró el evento en
    // "Probar eventos" y no había forma de saber si Meta lo había recibido: un envío mudo cuando sale
    // bien es indistinguible de uno que nunca salió. Meta responde `events_received` y un
    // `fbtrace_id` (lo que pide su soporte); nada de eso lleva el token ni el correo.
    const resumen = (await respuesta.text().catch(() => '')).slice(0, 500);
    console.info('[meta] Subscribe aceptado:', resumen);
    return 'enviado';
  } catch (error) {
    console.error('[meta] Subscribe no se pudo enviar:', error instanceof Error ? error.message : 'error de red');
    return 'error';
  }
}

// Correos de los DUEÑOS activos de todos los comercios de la cuenta que pagó. La cuenta es la que
// paga, pero la persona está en `usuarios_comercio` (una cuenta puede tener varios comercios y más
// de un dueño): se mandan todos, cifrados, y Meta usa el que reconozca. Cajeros NO.
export async function correosDeDuenos(supabase: SupabaseClient<Database>, cuentaId: string): Promise<string[]> {
  const { data: comercios, error: eComercios } = await supabase
    .from('comercios')
    .select('id')
    .eq('cuenta_id', cuentaId);
  if (eComercios || !comercios?.length) return [];

  const { data: duenos, error: eDuenos } = await supabase
    .from('usuarios_comercio')
    .select('email')
    .in('comercio_id', comercios.map((c) => c.id))
    .eq('rol', 'owner')
    .eq('activo', true);
  if (eDuenos) return [];
  return (duenos ?? []).map((d) => d.email);
}

// Punto de entrada para quien registra un pago. Nunca lanza: el cobro ya quedó guardado, y un fallo
// de Meta no puede convertirse en un error para FM.
export async function notificarPagoAMeta(
  supabase: SupabaseClient<Database>,
  pago: { cuentaId: string; cobroId: string; monto: number },
): Promise<ResultadoEnvio> {
  try {
    const correos = await correosDeDuenos(supabase, pago.cuentaId);
    const resultado = await enviarSubscribe(
      { cobroId: pago.cobroId, monto: pago.monto, correos, ahora: new Date() },
      {
        token: process.env.META_CAPI_TOKEN,
        idPixel: process.env.NEXT_PUBLIC_META_PIXEL_ID,
        codigoPrueba: process.env.META_CAPI_TEST_EVENT_CODE,
      },
    );
    // 'enviado' y 'error' ya dejaron su línea. Los otros dos son silenciosos por naturaleza (no hubo
    // envío) y son justo los que confunden: una variable que no llegó al deploy, o una cuenta sin
    // dueño activo. Solo el resultado y el id de la cuenta; el correo, nunca.
    if (resultado === 'sin-configurar' || resultado === 'sin-datos') {
      console.warn('[meta] Subscribe no enviado:', resultado, 'cuenta', pago.cuentaId);
    }
    return resultado;
  } catch (error) {
    console.error('[meta] Subscribe falló antes de enviar:', error instanceof Error ? error.message : error);
    return 'error';
  }
}
