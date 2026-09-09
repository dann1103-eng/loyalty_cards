import { describe, it, expect } from 'vitest';
import { construirClase, construirObjeto } from './construirRecursos';

// Lo que el objeto sabe del frente del pase además del contador: la vigencia, si el cupón ya se
// usó, el nombre del pase y el "hoy" del comercio. Los cuatro son OBLIGATORIOS en
// TarjetaParaObjeto a propósito (mismo criterio que `ubicaciones`): que el compilador obligue a
// cada llamador a decidir, en vez de que una ruta nueva se olvide en silencio.
const frenteBase = { vigenciaHasta: null, usadoEn: null, nombrePase: null, hoyIso: '2026-09-09' };

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
      ...frenteBase, qrToken: 'tok-1', puntosActuales: 42, tipoTarjeta: 'puntos', selloMeta: null, ubicaciones: [],
    });
    expect(obj.id).toBe('123.tarjeta_xyz');
    expect(obj.classId).toBe('123.comercio_abc');
    expect(obj.state).toBe('ACTIVE');
    expect(obj.barcode).toEqual({ type: 'QR_CODE', value: 'tok-1' });
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 42 } });
  });

  it('tarjeta de sellos: loyaltyPoints usa balance.string con "N de M sellos"', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-2', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos' } });
  });

  it('sellos sin meta configurada (selloMeta null) cae al entero pelado, no revienta', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-3', puntosActuales: 5, tipoTarjeta: 'sellos', selloMeta: null, ubicaciones: [],
    });
    // La etiqueta sigue siendo "Sellos" —es lo que la tarjeta ES— aunque no haya meta contra la
    // cual compararse. Antes decía "Puntos", que le mentía al cliente sobre su propia tarjeta.
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { int: 5 } });
  });

  // El bug que motivó contadorPase: gift card y cashback guardan CENTAVOS en puntos_actuales, y
  // esta función mandaba balance.int para todo lo que no fuera sellos. Un saldo de $25.00 llegaba
  // a Google Wallet como "Puntos 2500".
  it('gift card: el saldo va como dinero formateado, no como entero de centavos', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-7', puntosActuales: 2500, tipoTarjeta: 'gift_card', selloMeta: null, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Saldo', balance: { string: '$25.00' } });
  });

  it('descuento: NO lleva loyaltyPoints (Google rechaza null y "Puntos 0" no dice nada)', () => {
    // Su estado es un porcentaje que sale de niveles_descuento, un dato que el objeto no recibe.
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-8', puntosActuales: 0, tipoTarjeta: 'descuento', selloMeta: null, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toBeUndefined();
    expect('loyaltyPoints' in obj).toBe(false);
  });

  it('sellos con meta y con heroImageUrl: incluye heroImage a nivel de objeto (grilla por cliente)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-4', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, ubicaciones: [],
      heroImageUrl: 'https://ejemplo.com/api/tarjetas/xyz/hero.png',
    });
    expect(obj.heroImage).toEqual({ sourceUri: { uri: 'https://ejemplo.com/api/tarjetas/xyz/hero.png' } });
  });

  it('sellos sin heroImageUrl (ej. NEXT_PUBLIC_BASE_URL ausente): omite heroImage, no manda uri vacía', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-5', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, heroImageUrl: null,
      ubicaciones: [],
    });
    expect(obj.heroImage).toBeUndefined();
  });

  // LA prueba de `listado`. En Google el contador va SIEMPRE en loyaltyPoints, también cuando el
  // objeto lleva su grilla compuesta en heroImage: es lo que se lee en la vista de LISTA de Wallet,
  // donde la imagen no cabe.
  //
  // MUTACIÓN: cambiar `frente.listado` por `frente.primario` en loyaltyPointsDe. Con grilla,
  // frentePase devuelve `primario: null` (el texto taparía los círculos en Apple) y esta tarjeta
  // saldría SIN loyaltyPoints: cada Android con una tarjeta de sellos perdería su contador, sin un
  // solo error del lado de Google.
  it('sellos CON grilla en el heroImage: el contador SIGUE yendo en loyaltyPoints (vista de lista)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-9', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8,
      ubicaciones: [], heroImageUrl: 'https://ejemplo.com/api/tarjetas/xyz/hero.png',
    });
    expect(obj.heroImage).toBeDefined();
    // Y con la palabra UNA sola vez: el listado ya la trae, así que Google no la agrega encima
    // ("3 de 8 sellos sellos" era el otro extremo del mismo error).
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos' } });
  });

  it('puntos (no sellos): NUNCA incluye heroImage propio aunque venga heroImageUrl — se ve el de la clase', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-6', puntosActuales: 40, tipoTarjeta: 'puntos', selloMeta: null, ubicaciones: [],
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
  const base = { ...frenteBase, qrToken: 'tok-geo', puntosActuales: 5, tipoTarjeta: 'puntos', selloMeta: null };

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

// El defecto que cierra este grupo: el frente del pase de una membresía mostraba solo el logo, la
// franja y el nombre del cliente. Ni cómo se llama la tarjeta ni hasta cuándo está activa.
describe('construirObjeto — identidad y vigencia del pase', () => {
  const base = { qrToken: 'tok-id', puntosActuales: 0, selloMeta: null, ubicaciones: [] };

  it('membresía vigente: el estado va en loyaltyPoints y la fecha en validTimeInterval', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia', vigenciaHasta: '2026-10-12',
    });
    expect(obj.loyaltyPoints).toEqual({
      label: 'Membresía',
      balance: { string: 'Activa hasta el 12 de octubre de 2026' },
    });
    // `validTimeInterval` es lo que hace que un pase VENCIDO se vea vencido en Android: Google mueve
    // el objeto a "Pases caducados" solo. Sin offset a propósito: la propia API documenta que un
    // date/time sin offset es hora LOCAL del teléfono, que es lo que quiere decir "vence el 12".
    // Con `Z` el pase se apagaría a las 6 de la tarde del 12 en El Salvador.
    expect(obj.validTimeInterval).toEqual({ end: { date: '2026-10-12T23:59:59' } });
  });

  it('membresía vencida: lo dice el texto Y el intervalo, que ya quedó en el pasado', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia', vigenciaHasta: '2026-08-03',
    });
    expect(obj.loyaltyPoints!.balance).toEqual({ string: 'Vencida el 3 de agosto de 2026' });
    expect(obj.validTimeInterval).toEqual({ end: { date: '2026-08-03T23:59:59' } });
  });

  it('sin fecha de vigencia NO manda validTimeInterval (una membresía sin activar no está vencida)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia',
    });
    expect(obj.validTimeInterval).toBeUndefined();
    expect(obj.loyaltyPoints!.balance).toEqual({ string: 'Sin activar' });
  });

  it('los tipos SIN vigencia nunca mandan validTimeInterval, aunque la fila traiga una fecha', () => {
    // `tarjetas.vigencia_hasta` solo la usan cupón y membresía; una fecha en una tarjeta de puntos
    // sería basura de una migración vieja, y apagarle el pase al cliente por eso sería peor.
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'puntos', puntosActuales: 40, vigenciaHasta: '2020-01-01',
    });
    expect(obj.validTimeInterval).toBeUndefined();
  });

  it('el nombre del pase viaja en textModulesData; sin nombre, la clave ni aparece', () => {
    const conNombre = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia', nombrePase: 'Socio Oro',
    });
    expect(conNombre.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Socio Oro' },
    ]);

    const sinNombre = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia',
    });
    expect(sinNombre.textModulesData).toBeUndefined();
    expect('textModulesData' in sinNombre).toBe(false);
  });

  it('cupón ya usado: lo dice el texto (usadoEn gana sobre la fecha)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'cupon',
      vigenciaHasta: '2026-09-30', usadoEn: '2026-09-05T15:00:00Z',
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Cupón', balance: { string: 'Ya usado' } });
  });
});
