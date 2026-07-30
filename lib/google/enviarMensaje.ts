import { walletClient } from './walletClient';

// Manda un mensaje a UN LoyaltyObject puntual — nunca a nivel de LoyaltyClass, aunque sería más
// eficiente para una campaña que apunta a "todos los programas": una llamada a nivel clase no
// puede excluir una tarjeta puntual, y el candado de 3/24h por tarjeta (ver
// lib/comercio/enviarMensajeTarjeta.ts) exige poder hacerlo. Ver la sección "Riesgos y
// pendientes" del spec.
//
// messageType: 'TEXT' — es lo que documenta Google para este endpoint, pero SIN confirmar todavía
// contra un dispositivo real que dispare notificación (y no solo quede en el historial del pase).
// Esa confirmación manual está pendiente (ver ESTADO-Y-PLAN-2026-07-28.md, QA de notificaciones
// push). Si alguien la corre y falla, este es el primer lugar a revisar.
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
