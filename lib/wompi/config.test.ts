import { describe, it, expect } from 'vitest';
import { leerConfigWompi, pruebasAceptadas } from './config';

// MUTATION-TESTING (cada fila se corrió):
//   - aceptar pruebas cuando VERCEL_ENV = 'preview'      → falla "un despliegue Preview NO acepta pruebas"
//   - aceptar pruebas cuando VERCEL_ENV = 'production'   → falla "producción NO acepta pruebas"
//   - ignorar WOMPI_ACEPTAR_PRUEBAS                      → falla "sin el flag no se aceptan pruebas"
//   - aceptar un VERCEL_ENV desconocido                  → falla "un valor desconocido de VERCEL_ENV rechaza"

describe('pruebasAceptadas', () => {
  it('sin WOMPI_ACEPTAR_PRUEBAS=1 no se aceptan pruebas, en ningún entorno', () => {
    expect(pruebasAceptadas({})).toBe(false);
    expect(pruebasAceptadas({ VERCEL_ENV: 'development' })).toBe(false);
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: 'true' })).toBe(false);
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '0' })).toBe(false);
  });

  it('en desarrollo local (sin VERCEL_ENV) o con VERCEL_ENV=development, sí', () => {
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '1' })).toBe(true);
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '1', VERCEL_ENV: '' })).toBe(true);
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '1', VERCEL_ENV: 'development' })).toBe(true);
  });

  it('producción NO acepta pruebas, aunque alguien deje el flag puesto', () => {
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '1', VERCEL_ENV: 'production' })).toBe(false);
  });

  it('un despliegue Preview NO acepta pruebas: comparte la base real', () => {
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '1', VERCEL_ENV: 'preview' })).toBe(false);
  });

  it('un valor desconocido de VERCEL_ENV rechaza en vez de aceptar', () => {
    expect(pruebasAceptadas({ WOMPI_ACEPTAR_PRUEBAS: '1', VERCEL_ENV: 'staging' })).toBe(false);
  });
});

describe('leerConfigWompi', () => {
  const base = { WOMPI_CLIENT_ID: ' id ', WOMPI_CLIENT_SECRET: ' secreto ' };

  it('lee las credenciales sin espacios y usa las URLs por defecto', () => {
    expect(leerConfigWompi(base)).toEqual({
      clientId: 'id',
      clientSecret: 'secreto',
      urlApi: 'https://api.wompi.sv',
      urlId: 'https://id.wompi.sv',
      aceptarPruebas: false,
    });
  });

  it('respeta las URLs del entorno y les quita la barra final', () => {
    const c = leerConfigWompi({ ...base, WOMPI_API_URL: 'https://api.ejemplo.test//', WOMPI_ID_URL: 'https://id.ejemplo.test/' });
    expect(c.urlApi).toBe('https://api.ejemplo.test');
    expect(c.urlId).toBe('https://id.ejemplo.test');
  });

  it('lanza un mensaje claro si falta una credencial, sin nombrar su valor', () => {
    expect(() => leerConfigWompi({ WOMPI_CLIENT_SECRET: 'x' })).toThrow('Falta la variable de entorno WOMPI_CLIENT_ID');
    expect(() => leerConfigWompi({ WOMPI_CLIENT_ID: 'x' })).toThrow('Falta la variable de entorno WOMPI_CLIENT_SECRET');
    expect(() => leerConfigWompi({ WOMPI_CLIENT_ID: '  ', WOMPI_CLIENT_SECRET: 'x' })).toThrow('WOMPI_CLIENT_ID');
  });
});
