import { walletClient } from './walletClient';

// Manda un mensaje a UN LoyaltyObject puntual — nunca a nivel de LoyaltyClass, aunque sería más
// eficiente para una campaña que apunta a "todos los programas": una llamada a nivel clase no
// puede excluir una tarjeta puntual, y el candado de 3/24h por tarjeta (ver
// lib/comercio/enviarMensajeTarjeta.ts) exige poder hacerlo. Ver la sección "Riesgos y
// pendientes" del spec.
//
// messageType: 'TEXT' — verificado contra Wallet real que dispara notificación (no solo historial
// del pase). Si Google cambia este comportamiento, es el primer lugar a revisar.
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
      requestBody: { message: { header, body, messageType: 'TEXT' } },
    });
    return true;
  } catch (err) {
    console.error('[google] no se pudo mandar el mensaje:', err);
    return false;
  }
}
