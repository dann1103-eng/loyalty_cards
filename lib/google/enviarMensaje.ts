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
export async function enviarMensajeGoogle(
  objectId: string,
  header: string,
  body: string,
): Promise<boolean> {
  try {
    const client = walletClient();
    await client.loyaltyobject.addmessage({
      resourceId: objectId,
      requestBody: { message: { header, body, messageType: 'TEXT_AND_NOTIFY' } },
    });
    return true;
  } catch (err) {
    console.error('[google] no se pudo mandar el mensaje:', err);
    return false;
  }
}
