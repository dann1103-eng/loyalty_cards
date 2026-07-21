import { google } from 'googleapis';
import type { walletobjects_v1 } from 'googleapis/build/src/apis/walletobjects/v1';
import { requireEnv } from '@/lib/env';

// Único scope que necesita la cuenta de servicio: crear/editar clases y objetos del Emisor.
// [Fuente: developers.google.com/wallet/retail/loyalty-cards/rest — verificado 2026-07-20]
const SCOPES = ['https://www.googleapis.com/auth/wallet_object.issuer'];

export interface CredencialesServicio {
  client_email: string;
  private_key: string;
}

// Misma convención que cargarCertificados() en lib/apple/generatePass.ts: la clave completa
// (aquí un JSON, allá un PEM) vive en una sola variable de entorno en base64.
export function credencialesServicio(): CredencialesServicio {
  const json = Buffer.from(requireEnv('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_B64'), 'base64').toString('utf-8');
  let datos: unknown;
  try {
    datos = JSON.parse(json);
  } catch {
    throw new Error('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_B64 no contiene JSON válido.');
  }
  const { client_email, private_key } = datos as Record<string, unknown>;
  if (typeof client_email !== 'string' || typeof private_key !== 'string') {
    throw new Error('GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_B64 no tiene el formato de una cuenta de servicio.');
  }
  return { client_email, private_key };
}

export function issuerId(): string {
  return requireEnv('GOOGLE_WALLET_ISSUER_ID');
}

export function walletClient(): walletobjects_v1.Walletobjects {
  const auth = new google.auth.GoogleAuth({ credentials: credencialesServicio(), scopes: SCOPES });
  return google.walletobjects({ version: 'v1', auth });
}
