import { walletClient } from './walletClient';

// Manda un mensaje a UN LoyaltyObject puntual — nunca a nivel de LoyaltyClass, aunque sería más
// eficiente para una campaña que apunta a "todos los programas": una llamada a nivel clase no
// puede excluir una tarjeta puntual, y el candado de 3/24h por tarjeta (ver
// lib/comercio/enviarMensajeTarjeta.ts) exige poder hacerlo. Ver la sección "Riesgos y
// pendientes" del spec.
//
// messageType: 'TEXT_AND_NOTIFY' y NUNCA 'TEXT'. Es la diferencia entre que el cliente reciba una
// notificación o que no vea absolutamente nada: 'TEXT' solo escribe el mensaje en la pantalla de
// detalle del pase, en silencio. Se descubrió con una campaña real que no llegó a ningún teléfono
// (2026-07-30) — la API la aceptó y devolvió éxito igual, así que NO hay forma de detectar el error
// desde el código. Documentación: TEXT "renders the message as text on the card details screen";
// TEXT_AND_NOTIFY "renders the message as text on the card details screen and as an Android
// notification".
// [developers.google.com/wallet/reference/rest/v1/Message]
//
// Ojo con el cupo: Google permite 3 mensajes con notificación por 24h y responde
// QuotaExceededException al cuarto (no lo descarta en silencio). El candado que lo respeta vive en
// lib/comercio/enviarMensajeTarjeta.ts.
//
// Best-effort a propósito, mismo criterio que notificarCambioTarjeta: un fallo de Google Wallet
// nunca debe tumbar el flujo que lo llama.
export interface ResultadoMensajeGoogle {
  // La llamada a la API salió bien.
  ok: boolean;
  // ALGUIEN tiene de verdad el pase guardado en su teléfono. Es un dato DISTINTO de `ok`: un
  // LoyaltyObject existe desde que nosotros lo creamos, así que el addmessage devuelve éxito aunque
  // nadie lo haya guardado nunca y el mensaje no llegue a ningún lado. Sin esta distinción el dueño
  // ve "6 tarjetas alcanzadas" cuando el pase lo tienen 2 personas (caso real, 2026-07-30).
  tieneUsuarios: boolean;
}

export async function enviarMensajeGoogle(
  objectId: string,
  header: string,
  body: string,
): Promise<ResultadoMensajeGoogle> {
  try {
    const client = walletClient();
    // La respuesta trae el objeto ya actualizado en `resource`, así que hasUsers sale de acá sin
    // pagar una llamada extra por tarjeta.
    const res = await client.loyaltyobject.addmessage({
      resourceId: objectId,
      requestBody: { message: { header, body, messageType: 'TEXT_AND_NOTIFY' } },
    });
    // `=== true` a propósito: hasUsers lo pone la plataforma y es opcional en el tipo. Ante un
    // undefined preferimos NO contar la tarjeta — todo el punto de este dato es dejar de inflar el
    // número que ve el dueño, así que ante la duda va para abajo, nunca para arriba.
    return { ok: true, tieneUsuarios: res.data.resource?.hasUsers === true };
  } catch (err) {
    console.error('[google] no se pudo mandar el mensaje:', err);
    return { ok: false, tieneUsuarios: false };
  }
}
