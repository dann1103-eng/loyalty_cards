import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Los Server Actions comparten firma (estadoPrevio, formData) por contrato de useActionState,
  // aunque una acción concreta (p.ej. accionEliminarComercio) no necesite leer alguno de los
  // dos. El prefijo `_` ya era la convención en este archivo antes de este override — sin
  // argsIgnorePattern, no-unused-vars solo la respeta quirúrgicamente (su modo 'after-used'
  // ignora los args no usados que preceden al último usado, así que _estadoPrevio nunca había
  // disparado el warning; en accionEliminarComercio, `id` sí se usa y es el último parámetro
  // usado, así que sin esto SÍ marcaría _estadoPrevio y _formData).
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
