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
    // hookTimeout MAYOR que testTimeout a propósito, desde el 2026-07-30: el `limpiar()` del
    // fixture pasó de 11 a 13 consultas secuenciales cuando aprendió a borrar por comercio_id
    // (necesario para no dejar huérfanos — ver el comentario largo en entornoComercio.ts). Con 20 s
    // la suite COMPLETA empezó a tirar "Hook timed out" en programas.test.ts bajo carga, mientras
    // ese mismo archivo pasaba 32/32 corrido solo: flake, no defecto. El teardown hace más
    // round-trips que cualquier test individual, así que merece más margen que ellos.
    hookTimeout: 45000,
    // Ejecuta los archivos de test en serie (no en paralelo). Varios archivos golpeando la
    // misma BD remota a la vez causaban inserts que devolvían null bajo contención (flake no
    // determinista). En serie es más lento pero determinista — el trade correcto para una
    // suite de integración contra una sola BD.
    fileParallelism: false,
    // Además de los defaults de Vitest (node_modules, dist, etc.), excluye `.claude/`: cuando el
    // repo tiene un git worktree hospedado en `.claude/worktrees/…` (checkout de otra rama en disco),
    // Vitest descubriría y correría TAMBIÉN esos archivos de prueba, inflando el conteo y ocultando
    // regresiones. Ninguna prueba real del proyecto vive bajo `.claude/`.
    exclude: [...configDefaults.exclude, '**/.claude/**', 'e2e/**'],
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
