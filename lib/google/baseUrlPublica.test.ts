import { describe, it, expect } from 'vitest';
import { esBaseUrlPublica } from './baseUrlPublica';

// Protege a scripts/actualizar-frente-google.ts: con una base que Google no puede descargar, la API
// rechaza el patch ENTERO (`400 Image cannot be loaded`) y la corrida sobre producción termina en
// fallos para todas las tarjetas.
//
// Mutaciones verificadas el 2026-09-17 (cada una hace FALLAR la prueba nombrada; restauradas):
//   1. Aceptar `http://` —`url.startsWith('https://') || url.startsWith('http://')`— hace fallar
//      "rechaza http:// aunque el host sea el de producción".
//   2. Sacar `'localhost'` de HOSTS_LOCALES hace fallar "rechaza localhost aunque venga con https://".
//   3. Sacar el try/catch alrededor de `new URL` hace fallar "rechaza, sin lanzar, un https:// que no
//      se puede interpretar" (lanza `TypeError: Invalid URL` en vez de devolver false).
describe('esBaseUrlPublica', () => {
  it('acepta el dominio de producción, con y sin barra final', () => {
    expect(esBaseUrlPublica('https://www.cardly-sv.site')).toBe(true);
    expect(esBaseUrlPublica('https://www.cardly-sv.site/')).toBe(true);
  });

  it('rechaza http:// aunque el host sea el de producción', () => {
    expect(esBaseUrlPublica('http://www.cardly-sv.site')).toBe(false);
  });

  it('rechaza el valor típico de una máquina de desarrollo', () => {
    expect(esBaseUrlPublica('http://localhost:3000')).toBe(false);
  });

  it('rechaza localhost aunque venga con https://', () => {
    expect(esBaseUrlPublica('https://localhost:3000')).toBe(false);
    // El host se compara ya normalizado por `URL`: las mayúsculas no lo cuelan.
    expect(esBaseUrlPublica('https://LOCALHOST')).toBe(false);
  });

  it('rechaza 127.0.0.1 aunque venga con https://', () => {
    expect(esBaseUrlPublica('https://127.0.0.1:3000')).toBe(false);
  });

  it('rechaza la variable ausente o vacía', () => {
    expect(esBaseUrlPublica(undefined)).toBe(false);
    expect(esBaseUrlPublica('')).toBe(false);
  });

  it('rechaza, sin lanzar, un https:// que no se puede interpretar', () => {
    expect(esBaseUrlPublica('https://')).toBe(false);
  });

  it('rechaza un valor con espacios delante: la URL de la imagen se arma con el texto crudo', () => {
    expect(esBaseUrlPublica(' https://www.cardly-sv.site')).toBe(false);
  });
});
