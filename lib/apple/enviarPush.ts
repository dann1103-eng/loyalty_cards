import apn from '@parse/node-apn';
import { requireEnv } from '@/lib/env';

let provider: apn.Provider | null = null;

function obtenerProvider(): apn.Provider {
  if (!provider) {
    provider = new apn.Provider({
      token: {
        key: Buffer.from(requireEnv('APNS_KEY_B64'), 'base64'),
        keyId: requireEnv('APNS_KEY_ID'),
        teamId: requireEnv('APPLE_TEAM_ID'),
      },
      production: true, // los push de actualización de pass SOLO funcionan en producción, nunca en sandbox
    });
  }
  return provider;
}

// @parse/node-apn (lib/client.js, dentro de Client.prototype.request) trae:
//   if (notification.body !== '{}') { request.write(notification.body); }
// Es decir: cuando el payload compilado es EXACTAMENTE el string "{}" — el payload vacío que
// Apple exige para actualizar passes — la librería directamente OMITE escribir el cuerpo, y
// Apple recibe 0 bytes en vez de "{}". APNs responde 400 "PayloadEmpty" y el push nunca llega,
// sin lanzar ninguna excepción (confirmado empíricamente contra APNs real, 2026-07-16: mismo
// código produciendo reason:"PayloadEmpty" en cada intento). Es un bug de la librería para este
// caso de uso específico (nadie más manda un payload deliberadamente vacío), no un error nuestro.
//
// Workaround: pre-fijamos el caché interno `compiled` (no está en el tipado público) a un JSON
// válido y equivalente a `{}` pero que NO calza con el string exacto que la librería filtra — un
// espacio inicial es JSON válido (RFC 8259 permite whitespace alrededor del valor) e indistinguible
// de `{}` para cualquier parser conforme, incluido el de Apple.
interface NotificationConCompilado {
  compiled: string | false;
}

export async function enviarPushActualizacion(pushToken: string, passTypeIdentifier: string) {
  const note = new apn.Notification();
  note.topic = passTypeIdentifier; // el topic es el Pass Type ID, NO un bundle ID de app
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.priority = 10;
  note.rawPayload = {}; // Apple exige un payload vacío para actualizaciones de pass

  (note as unknown as NotificationConCompilado).compiled = ' {}';

  return obtenerProvider().send(note, pushToken);
}
