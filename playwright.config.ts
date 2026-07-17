import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

// Playwright NO carga .env.local por su cuenta (a diferencia de Vitest vía vitest.setup.ts, y de
// Next para el dev server). Los specs leen credenciales en su PROPIO proceso: el cliente de
// limpieza de registro.spec.ts y los test.skip de los flujos de FM/dueño (E2E_*). Sin esto,
// createClient() lanza "supabaseUrl is required" al importar. Se carga antes de defineConfig.
config({ path: '.env.local' });

// Levanta el dev server automáticamente y corre contra él. Sin CI: reutiliza un server ya abierto.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
