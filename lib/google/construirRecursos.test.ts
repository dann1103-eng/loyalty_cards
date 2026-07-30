import { describe, it, expect } from 'vitest';
import { construirClase, construirObjeto } from './construirRecursos';

describe('construirClase', () => {
  it('arma una LoyaltyClass con issuerName/programName = nombre del comercio y el logo requerido', () => {
    const clase = construirClase('123.comercio_abc', {
      nombre: 'Café Aurora',
      colorFondo: 'rgb(36, 24, 18)',
      logoUrl: 'https://ejemplo.com/logo.png',
      heroUrl: null,
      ubicaciones: [],
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
      ubicaciones: [],
    });
    expect(clase.heroImage).toBeUndefined();
    expect(clase.hexBackgroundColor).toBeUndefined();
  });

  it('incluye heroImage cuando el comercio sí subió una foto de franja', () => {
    const clase = construirClase('123.comercio_abc', {
      nombre: 'X', colorFondo: null, logoUrl: 'https://ejemplo.com/logo.png', heroUrl: 'https://ejemplo.com/hero.png',
      ubicaciones: [],
    });
    expect(clase.heroImage).toEqual({ sourceUri: { uri: 'https://ejemplo.com/hero.png' } });
  });
});

describe('construirObjeto', () => {
  it('tarjeta de puntos: loyaltyPoints usa balance.int con el saldo actual', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-1', puntosActuales: 42, tipoTarjeta: 'puntos', selloMeta: null, ubicaciones: [],
    });
    expect(obj.id).toBe('123.tarjeta_xyz');
    expect(obj.classId).toBe('123.comercio_abc');
    expect(obj.state).toBe('ACTIVE');
    expect(obj.barcode).toEqual({ type: 'QR_CODE', value: 'tok-1' });
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 42 } });
  });

  it('tarjeta de sellos: loyaltyPoints usa balance.string con "N de M sellos"', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-2', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos' } });
  });

  it('sellos sin meta configurada (selloMeta null) cae al formato de puntos, no revienta', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-3', puntosActuales: 5, tipoTarjeta: 'sellos', selloMeta: null, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 5 } });
  });

  it('sellos con meta y con heroImageUrl: incluye heroImage a nivel de objeto (grilla por cliente)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-4', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, ubicaciones: [],
      heroImageUrl: 'https://ejemplo.com/api/tarjetas/xyz/hero.png',
    });
    expect(obj.heroImage).toEqual({ sourceUri: { uri: 'https://ejemplo.com/api/tarjetas/xyz/hero.png' } });
  });

  it('sellos sin heroImageUrl (ej. NEXT_PUBLIC_BASE_URL ausente): omite heroImage, no manda uri vacía', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-5', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, heroImageUrl: null,
      ubicaciones: [],
    });
    expect(obj.heroImage).toBeUndefined();
  });

  it('puntos (no sellos): NUNCA incluye heroImage propio aunque venga heroImageUrl — se ve el de la clase', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      qrToken: 'tok-6', puntosActuales: 40, tipoTarjeta: 'puntos', selloMeta: null, ubicaciones: [],
      heroImageUrl: 'https://ejemplo.com/api/tarjetas/xyz/hero.png',
    });
    expect(obj.heroImage).toBeUndefined();
  });
});

describe('construirClase — geopush', () => {
  const base = {
    nombre: 'Café Aurora',
    colorFondo: null,
    logoUrl: 'https://ejemplo.com/logo.png',
    heroUrl: null,
  };

  it('sin ubicaciones NO manda merchantLocations', () => {
    // Un arreglo vacío sería ruido en la clase de todos los comercios que no usan geopush.
    const clase = construirClase('123.comercio_abc', { ...base, ubicaciones: [] });
    expect(clase.merchantLocations).toBeUndefined();
  });

  it('manda merchantLocations, NO el campo locations que la API marca como deprecado', () => {
    const clase = construirClase('123.comercio_abc', {
      ...base,
      ubicaciones: [{ latitud: 13.6989, longitud: -89.1914 }],
    });
    expect(clase.merchantLocations).toEqual([{ latitude: 13.6989, longitude: -89.1914 }]);
    // `locations` (LatLongPoint) es el campo viejo: la propia definición de la API dice
    // "This field replaces the deprecated LatLongPoints". Mandar los dos es pedir problemas.
    expect(clase.locations).toBeUndefined();
  });

  it('corta en 10 ubicaciones porque Google RECHAZA la clase entera si mandás más', () => {
    // Diferencia clave con Apple, que simplemente ignora de la 11 en adelante: acá pasarse deja al
    // comercio SIN Google Wallet, no sin geopush. El corte es lo que evita ese fallo total.
    const doce = Array.from({ length: 12 }, (_, i) => ({ latitud: 13.6 + i / 1000, longitud: -89.1 }));
    const clase = construirClase('123.comercio_abc', { ...base, ubicaciones: doce });
    expect(clase.merchantLocations).toHaveLength(10);
  });

  it('no lleva texto: en Android el mensaje lo pone Google y no se puede editar', () => {
    // Fijado como prueba para que nadie pierda tiempo buscando dónde poner el mensaje del lado de
    // Google. MerchantLocation solo tiene latitude y longitude.
    const clase = construirClase('123.comercio_abc', {
      ...base,
      ubicaciones: [{ latitud: 13.6989, longitud: -89.1914 }],
    });
    expect(Object.keys(clase.merchantLocations![0]).sort()).toEqual(['latitude', 'longitude']);
  });
});

// Las ubicaciones van en la CLASE **y** en el OBJETO. La documentación de Google es imperativa al
// respecto ("you need to add locations to your classes and objects... up to 10 per class and 10 per
// object") y `LoyaltyObject.merchantLocations` está documentado como disparador por su cuenta, igual
// que el de la clase. Hasta el 2026-07-30 solo las poníamos en la clase — el geopush no llegaba a
// ningún Android y este era el único hueco del lado del servidor.
// [developers.google.com/wallet/retail/loyalty-cards/use-cases/trigger-push-notifications]
describe('construirObjeto — geopush', () => {
  const base = { qrToken: 'tok-geo', puntosActuales: 5, tipoTarjeta: 'puntos', selloMeta: null };

  it('sin ubicaciones NO manda merchantLocations', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', { ...base, ubicaciones: [] });
    expect(obj.merchantLocations).toBeUndefined();
  });

  it('manda merchantLocations en el OBJETO, no solo en la clase', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...base,
      ubicaciones: [{ latitud: 13.984415, longitud: -89.547671 }],
    });
    expect(obj.merchantLocations).toEqual([{ latitude: 13.984415, longitude: -89.547671 }]);
    // `locations` (LatLongPoint) está deprecado también a nivel de objeto y la propia API avisa que
    // ya no dispara notificaciones. Mandar los dos es pedir problemas.
    expect(obj.locations).toBeUndefined();
  });

  it('corta en 10 ubicaciones, igual que la clase', () => {
    const doce = Array.from({ length: 12 }, (_, i) => ({ latitud: 13.6 + i / 1000, longitud: -89.1 }));
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', { ...base, ubicaciones: doce });
    expect(obj.merchantLocations).toHaveLength(10);
  });
});
