import { config } from 'dotenv'; config({ path: '.env.local' });
const { createServiceClient } = await import('./lib/supabase/server.ts');
const { notificarCambioTarjeta } = await import('./lib/apple/notificarCambioTarjeta.ts');
const s = createServiceClient();
await notificarCambioTarjeta(s, '21ff26dd-2a1d-40af-91c9-7fe688fed1e4');
console.log('push de actualización enviado para la tarjeta de Daniel');
