import { describe, it, expect } from 'vitest';
import { construirClase, construirObjeto } from './construirRecursos';

describe('construirClase', () => {
  it('arma una LoyaltyClass con issuerName/programName = nombre del comercio y el logo requerido', () => {
    const clase = construirClase('123.comercio_abc', {
      nombre: 'Café Aurora',
      colorFondo: 'rgb(36, 24, 18)',
      logoUrl: 'https://ejemplo.com/logo.png',
      heroUrl: null,
    });
    expect(clase.id).toBe('123.comercio_abc');
    expect(clase.issuerName).toBe('Café Aurora');
    expect(clase.programName).toBe('Café Aurora');
    expect(clase.reviewStatus).toBe('UNDER_REVIEW');
    expect(clase.programLogo).toEqual({ sourceUri: { uri: 'https://ejemplo.com/logo.png' } });
    expect(clase.hexBackgroundColor).toBe('#241812');
  });

  it('omite heroImage cuando el comercio no tiene hero_url (no manda null ni cadena vacía)', () => {
    const clase = construirClase('123.comercio_abc', {
      nombre: 'X', colorFondo: null, logoUrl: 'https://ejemplo.com/logo.png', heroUrl: null,
    });
    expect(clase.heroImage).toBeUndefined();
    expect(clase.hexBackgroundColor).toBeUndefined();
  });

  it('incluye heroImage cuando el comercio sí subió una foto de franja', () => {
    const clase = construirClase('123.comercio_abc', {
      nombre: 'X', colorFondo: null, logoUrl: 'https://ejemplo.com/logo.png', heroUrl: 'https://ejemplo.com/hero.png',
    });
    expect(clase.heroImage).toEqual({ sourceUri: { uri: 'https://ejemplo.com/hero.png' } });
  });
});

describe('construirObjeto', () => {
  it('tarjeta de puntos: loyaltyPoints usa balance.int con el saldo actual', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-1', puntosActuales: 42, tipoTarjeta: 'puntos', selloMeta: null,
    });
    expect(obj.id).toBe('123.tarjeta_xyz');
    expect(obj.classId).toBe('123.comercio_abc');
    expect(obj.state).toBe('ACTIVE');
    expect(obj.barcode).toEqual({ type: 'QR_CODE', value: 'tok-1' });
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 42 } });
  });

  it('tarjeta de sellos: loyaltyPoints usa balance.string con "N de M sellos"', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-2', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8,
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos' } });
  });

  it('sellos sin meta configurada (selloMeta null) cae al formato de puntos, no revienta', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-3', puntosActuales: 5, tipoTarjeta: 'sellos', selloMeta: null,
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 5 } });
  });
});
