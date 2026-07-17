import { defineConfig, configDefaults } from 'vitest/config';
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
    // Ejecuta los archivos de test en serie (no en paralelo). Varios archivos golpeando la
    // misma BD remota a la vez causaban inserts que devolvían null bajo contención (flake no
    // determinista). En serie es más lento pero determinista — el trade correcto para una
    // suite de integración contra una sola BD.
    fileParallelism: false,
    // Además de los defaults de Vitest (node_modules, dist, etc.), excluye `.claude/`: cuando el
    // repo tiene un git worktree hospedado en `.claude/worktrees/…` (checkout de otra rama en disco),
    // Vitest descubriría y correría TAMBIÉN esos archivos de prueba, inflando el conteo y ocultando
    // regresiones. Ninguna prueba real del proyecto vive bajo `.claude/`.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
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
