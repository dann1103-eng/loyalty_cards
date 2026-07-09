import { existsSync } from 'node:fs';
import { config } from 'dotenv';

if (!existsSync('.env.local')) {
  throw new Error(
    'Falta .env.local — créalo a partir de .env.local.example (los tests de integración necesitan credenciales reales de Supabase).',
  );
}

config({ path: '.env.local' });
