import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // Los tests son de integración contra Supabase remoto; el default de 5s es muy justo
    // para inserts + teardown en red y produce flakes no deterministas. hookTimeout cubre
    // los afterEach, que también hacen round-trips.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // 'server-only' lanza un error al importarse fuera del entorno react-server
      // (p. ej. en Node/Vitest); se sustituye por un módulo vacío para poder testear
      // código de servidor que lo usa como guarda.
      'server-only': path.resolve(__dirname, 'test/stubs/empty.ts'),
    },
  },
});
