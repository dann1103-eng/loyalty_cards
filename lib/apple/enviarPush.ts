import apn from '@parse/node-apn';

let provider: apn.Provider | null = null;

function obtenerProvider(): apn.Provider {
  if (!provider) {
    provider = new apn.Provider({
      token: {
        key: Buffer.from(process.env.APNS_KEY_B64!, 'base64'),
        keyId: process.env.APNS_KEY_ID!,
        teamId: process.env.APPLE_TEAM_ID!,
      },
      production: true, // los push de actualización de pass SOLO funcionan en producción, nunca en sandbox
    });
  }
  return provider;
}

export async function enviarPushActualizacion(pushToken: string, passTypeIdentifier: string) {
  const note = new apn.Notification();
  note.topic = passTypeIdentifier; // el topic es el Pass Type ID, NO un bundle ID de app
  note.expiry = Math.floor(Date.now() / 1000) + 3600;
  note.priority = 10;
  note.rawPayload = {}; // Apple exige un payload vacío para actualizaciones de pass

  return obtenerProvider().send(note, pushToken);
}
