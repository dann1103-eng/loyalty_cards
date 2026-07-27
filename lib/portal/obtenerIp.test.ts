import { describe, it, expect } from 'vitest';
import { obtenerIp } from './obtenerIp';

const URL_CUALQUIERA = 'https://www.cardly-sv.site/';

describe('obtenerIp', () => {
  it('usa x-real-ip, que es la que pone Vercel', () => {
    const peticion = new Request(URL_CUALQUIERA, {
      headers: { 'x-real-ip': '190.53.1.1', 'x-forwarded-for': '1.2.3.4' },
    });

    expect(obtenerIp(peticion)).toBe('190.53.1.1');
  });

  it('sin x-real-ip toma el ÚLTIMO valor de x-forwarded-for, nunca el primero', () => {
    // El primero lo controla quien llama: si se usara ese, rotar la cabecera en cada envío
    // esquivaría el límite de intentos por completo.
    const peticion = new Request(URL_CUALQUIERA, {
      headers: { 'x-forwarded-for': '9.9.9.9, 190.53.1.1' },
    });

    expect(obtenerIp(peticion)).toBe('190.53.1.1');
  });

  it('sin ninguna cabecera de IP devuelve un cubo compartido', () => {
    expect(obtenerIp(new Request(URL_CUALQUIERA))).toBe('ip-desconocida');
  });

  it('acepta Headers sueltas: es lo único que puede conseguir un Server Action', () => {
    expect(obtenerIp(new Headers({ 'x-real-ip': '190.53.1.1' }))).toBe('190.53.1.1');
  });

  it('funciona con un objeto como el que devuelve headers() de Next, que además expone .headers', () => {
    // Réplica mínima del adaptador real de Next (server/web/spec-extension/adapters/headers.js):
    // extiende Headers PERO tiene una propiedad propia llamada `headers`. `ipAddress` distingue
    // Request de Headers justamente con `'headers' in input`, así que pasárselo tal cual lo manda
    // por la rama equivocada y truena. Si esta prueba se pone roja, el formulario público perdió
    // la IP real y todo el mundo comparte un solo cupo del límite anti-spam.
    class AdaptadorComoElDeNext extends Headers {
      headers = { 'x-real-ip': '190.53.1.1' };
    }

    expect(obtenerIp(new AdaptadorComoElDeNext({ 'x-real-ip': '190.53.1.1' }))).toBe('190.53.1.1');
  });
});
