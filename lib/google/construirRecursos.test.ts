import { describe, it, expect } from 'vitest';
import { construirClase, construirObjeto } from './construirRecursos';

// Lo que el objeto sabe del frente del pase además del contador: la vigencia, si el cupón ya se
// usó, el nombre del pase, el "hoy" del comercio, el nombre y apellido del cliente y la franja
// propia CRUDA de la marca. Todos OBLIGATORIOS en TarjetaParaObjeto a propósito (mismo criterio que
// `ubicaciones`): que el compilador obligue a cada llamador a decidir, en vez de que una ruta nueva
// se olvide en silencio.
const frenteBase = {
  vigenciaHasta: null,
  usadoEn: null,
  nombrePase: null,
  hoyIso: '2026-09-09',
  nombreCliente: null,
  apellidoCliente: null,
  stripUrl: null,
};

const HERO = 'https://ejemplo.com/api/tarjetas/xyz/hero.png?v=abc123def456';
const FRANJA_PROPIA = 'https://ejemplo.com/storage/franja.png';

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
    // "Powered by Cardly" debajo del QR (decisión 4 del spec), literal: en TODOS los pases de todos
    // los comercios. Antes esta prueba afirmaba el código SIN `alternateText`; se invirtió a propósito.
    expect(obj.barcode).toEqual({ type: 'QR_CODE', value: 'tok-1', alternateText: 'Powered by Cardly' });
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 42, string: null } });
  });

  // El sync hace `patch`, que MEZCLA. Un objeto que nació con `balance.int` (sellos sin meta, o
  // puntos) y que ahora manda `balance.string` quedaría con los dos puestos, y Google rechaza el
  // patch ENTERO: `400 More than one type of loyalty point balances cannot be set`. Esa tarjeta deja
  // de actualizar su saldo en Android sin un solo error a la vista — pasó de verdad el 2026-09-17.
  // MUTACIÓN: omitir el `int: null` / `string: null` hace fallar esta prueba.
  it('el balance manda SIEMPRE el otro tipo en null, para borrar el que tenía el objeto', () => {
    const conNumero = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-b1', puntosActuales: 7, tipoTarjeta: 'puntos', selloMeta: null, ubicaciones: [],
    });
    expect(conNumero.loyaltyPoints?.balance).toEqual({ int: 7, string: null });

    const conTexto = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-b2', puntosActuales: 2, tipoTarjeta: 'sellos', selloMeta: 5, ubicaciones: [],
    });
    expect(conTexto.loyaltyPoints?.balance).toEqual({ string: '2 de 5 sellos', int: null });
  });

  it('tarjeta de sellos: loyaltyPoints usa balance.string con "N de M sellos"', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-2', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos', int: null } });
  });

  it('sellos sin meta configurada (selloMeta null) cae al entero pelado, no revienta', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-3', puntosActuales: 5, tipoTarjeta: 'sellos', selloMeta: null, ubicaciones: [],
    });
    // La etiqueta sigue siendo "Sellos" —es lo que la tarjeta ES— aunque no haya meta contra la
    // cual compararse. Antes decía "Puntos", que le mentía al cliente sobre su propia tarjeta.
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { int: 5, string: null } });
  });

  // El bug que motivó contadorPase: gift card y cashback guardan CENTAVOS en puntos_actuales, y
  // esta función mandaba balance.int para todo lo que no fuera sellos. Un saldo de $25.00 llegaba
  // a Google Wallet como "Puntos 2500".
  it('gift card: el saldo va como dinero formateado, no como entero de centavos', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-7', puntosActuales: 2500, tipoTarjeta: 'gift_card', selloMeta: null, ubicaciones: [],
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Saldo', balance: { string: '$25.00', int: null } });
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
      heroImageUrl: HERO,
    });
    expect(obj.heroImage).toEqual({ sourceUri: { uri: HERO } });
  });

  // Vale para CUALQUIER tipo, no solo sellos: sin URL pública no hay hero que mandar.
  it('sin heroImageUrl (ej. NEXT_PUBLIC_BASE_URL ausente): omite heroImage en sellos y en gift card, no manda uri vacía', () => {
    const sellos = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-5', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8, heroImageUrl: null,
      ubicaciones: [],
    });
    expect(sellos.heroImage).toBeUndefined();
    expect('heroImage' in sellos).toBe(false);

    const giftCard = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-5b', puntosActuales: 2500, tipoTarjeta: 'gift_card', selloMeta: null,
      heroImageUrl: null, stripUrl: FRANJA_PROPIA, ubicaciones: [],
    });
    expect('heroImage' in giftCard).toBe(false);
  });

  // LA prueba de `listado`. En Google el contador va SIEMPRE en loyaltyPoints, también cuando el
  // objeto lleva su grilla compuesta en heroImage: es lo que se lee en la vista de LISTA de Wallet,
  // donde la imagen no cabe.
  //
  // MUTACIÓN: cambiar `frente.listado` por `frente.estado` en la llamada a loyaltyPointsDe. El
  // estado de los sellos es "3 de 8" SIN la palabra (va al lado del logo, bajo el rótulo SELLOS), y
  // esta prueba falla: en la vista de lista de Wallet no hay rótulo ni grilla que diga qué se cuenta.
  // (Antes del 2026-09-17 la mutación era `frente.primario`, que con grilla valía null y dejaba cada
  // Android sin contador; ese lugar ya no existe.)
  it('sellos CON grilla en el heroImage: el contador SIGUE yendo en loyaltyPoints (vista de lista)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-9', puntosActuales: 3, tipoTarjeta: 'sellos', selloMeta: 8,
      ubicaciones: [], heroImageUrl: HERO,
    });
    expect(obj.heroImage).toBeDefined();
    // Y con la palabra UNA sola vez: el listado ya la trae, así que Google no la agrega encima
    // ("3 de 8 sellos sellos" era el otro extremo del mismo error).
    expect(obj.loyaltyPoints).toEqual({ label: 'Sellos', balance: { string: '3 de 8 sellos', int: null } });
  });

  // INVERTIDA a propósito (spec 2026-09-17, decisión 8). Hasta acá afirmaba que puntos NUNCA llevaba
  // hero propio y se veía el de la clase: así los diseños de membresía, gift card y descuento —que
  // son sobre todo su franja— no existían en Android.
  it('puntos (no sellos): TAMBIÉN lleva el heroImage de SU tarjeta (la banda de marca o su franja propia)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, qrToken: 'tok-6', puntosActuales: 40, tipoTarjeta: 'puntos', selloMeta: null, ubicaciones: [],
      heroImageUrl: HERO,
    });
    expect(obj.heroImage).toEqual({ sourceUri: { uri: HERO } });
  });
});

// El frente nuevo en Google (spec 2026-09-17, sección "Google" → Objeto). Los cuatro módulos de texto
// son las celdas que la plantilla de la clase (Task 9, deploy B) va a acomodar en dos filas:
//   fila 1: nombre_pase | estado      fila 2: nombre | apellido
// Hasta el deploy B se ven abajo, en los detalles (inocuo). Por eso ESTA tarea va primero: con la
// plantilla puesta y objetos sin módulos, las tarjetas quedarían con filas vacías.
describe('construirObjeto — el frente de los diseños', () => {
  // MUTACIONES corridas el 2026-09-17 (cada una restaurada y el archivo comparado byte a byte):
  //
  // (a) hero solo en 'grilla'/'propia', en construirObjeto:
  //   `...(franjaDe(tarjeta) !== 'banda' && tarjeta.heroImageUrl ? { heroImage: … } : {})`
  //   → FALLAN "gift card SIN franja propia (banda)", "membresía vigente sobre la banda…" y "puntos
  //   (no sellos): TAMBIÉN lleva el heroImage…" con `expected undefined to deeply equal { Object
  //   (sourceUri) }`. Es la regresión que dejaría en Android la franja BORRADA para siempre: el sync
  //   hace `patch`, y un hero omitido deja el viejo.
  //
  // (b) omitir textModulesData cuando queda vacío:
  //   `...(modulosDelFrente(frente).length > 0 ? { textModulesData: modulosDelFrente(frente) } : {})`
  //   → FALLAN "descuento sin datos" (`- "textModulesData": []`) y "apellido sin nombre" (`expected
  //   undefined to deeply equal []`). Mismo motivo del patch: un nombre de pase borrado seguiría
  //   viéndose.
  //
  // (c) 'propia' sin mirar heroImageUrl, en franjaDe: subir `if (t.stripUrl) return 'propia';` por
  //   encima de `if (!t.heroImageUrl) return 'banda';`
  //   → FALLA "franja propia que NO llegó" con `expected [ { id: 'estado', …(2) } ] to deeply equal
  //   [ { id: 'nombre_pase', …(2) }, …(1) ]`: sin hero no hay franja, y tratarla como propia deja la
  //   tarjeta también sin el nombre del pase.

  it('membresía vigente sobre la banda, con nombre del pase y apellido: el cuerpo COMPLETO', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-memb',
      puntosActuales: 0,
      tipoTarjeta: 'membresia',
      selloMeta: null,
      vigenciaHasta: '2026-10-16',
      nombrePase: 'Mensualidad VIP',
      nombreCliente: 'María',
      apellidoCliente: 'Rivera',
      heroImageUrl: HERO,
      ubicaciones: [],
    });
    expect(obj).toEqual({
      id: '123.tarjeta_xyz',
      classId: '123.comercio_abc',
      state: 'ACTIVE',
      barcode: { type: 'QR_CODE', value: 'tok-memb', alternateText: 'Powered by Cardly' },
      loyaltyPoints: { label: 'Membresía', balance: { string: 'Activa hasta el 16 de octubre de 2026', int: null } },
      textModulesData: [
        { id: 'nombre_pase', header: 'Tarjeta', body: 'Mensualidad VIP' },
        { id: 'estado', header: 'VÁLIDO HASTA', body: '16/10/2026' },
        { id: 'nombre', header: 'NOMBRE', body: 'María' },
        { id: 'apellido', header: 'APELLIDO', body: 'Rivera' },
      ],
      validTimeInterval: { end: { date: '2026-10-16T23:59:59' } },
      heroImage: { sourceUri: { uri: HERO } },
    });
  });

  it('gift card con franja PROPIA que llegó: sin nombre_pase (la imagen ya trae su texto), con heroImage', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-gift',
      puntosActuales: 5000,
      tipoTarjeta: 'gift_card',
      selloMeta: null,
      nombrePase: 'Gift Card Estudio',
      nombreCliente: 'Ana',
      apellidoCliente: null,
      stripUrl: FRANJA_PROPIA,
      heroImageUrl: HERO,
      ubicaciones: [],
    });
    expect(obj).toEqual({
      id: '123.tarjeta_xyz',
      classId: '123.comercio_abc',
      state: 'ACTIVE',
      barcode: { type: 'QR_CODE', value: 'tok-gift', alternateText: 'Powered by Cardly' },
      loyaltyPoints: { label: 'Saldo', balance: { string: '$50.00', int: null } },
      textModulesData: [
        { id: 'estado', header: 'SALDO', body: '$50.00' },
        { id: 'nombre', header: 'NOMBRE', body: 'Ana' },
      ],
      heroImage: { sourceUri: { uri: HERO } },
    });
  });

  // El caso de la MUTACIÓN (a): una gift card sin franja propia ni grilla se ve en Android con la
  // banda de marca que ya ve en iPhone.
  it('gift card SIN franja propia (banda): con heroImage y con nombre_pase', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-gift-banda',
      puntosActuales: 2500,
      tipoTarjeta: 'gift_card',
      selloMeta: null,
      nombrePase: 'Gift Card Estudio',
      heroImageUrl: HERO,
      ubicaciones: [],
    });
    expect(obj.heroImage).toEqual({ sourceUri: { uri: HERO } });
    expect(obj.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Gift Card Estudio' },
      { id: 'estado', header: 'SALDO', body: '$25.00' },
    ]);
  });

  // El caso de la MUTACIÓN (c). Mismo criterio que Apple con `strips !== null`: lo que cuenta es qué
  // hay DE VERDAD en la franja, no qué subió el comercio.
  it('franja propia que NO llegó (sin heroImageUrl): es banda, y el nombre del pase SÍ se manda', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-sin-hero',
      puntosActuales: 2500,
      tipoTarjeta: 'gift_card',
      selloMeta: null,
      nombrePase: 'Gift Card Estudio',
      stripUrl: FRANJA_PROPIA,
      heroImageUrl: null,
      ubicaciones: [],
    });
    expect(obj.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Gift Card Estudio' },
      { id: 'estado', header: 'SALDO', body: '$25.00' },
    ]);
  });

  // El caso de la MUTACIÓN (b): nada que decir, y aun así la clave viaja, vacía.
  it('descuento sin datos: textModulesData SIEMPRE, aunque quede [] (el patch no borra lo que se omite)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-desc',
      puntosActuales: 0,
      tipoTarjeta: 'descuento',
      selloMeta: null,
      ubicaciones: [],
    });
    expect(obj).toEqual({
      id: '123.tarjeta_xyz',
      classId: '123.comercio_abc',
      state: 'ACTIVE',
      barcode: { type: 'QR_CODE', value: 'tok-desc', alternateText: 'Powered by Cardly' },
      textModulesData: [],
    });
    // Explícito además del toEqual: esta es la clave que un patch necesita ver para borrar un nombre
    // de pase viejo, y es la que la mutación (b) saca.
    expect('textModulesData' in obj).toBe(true);
    expect(obj.textModulesData).toEqual([]);
  });

  it('descuento con nombre del pase y cliente: sin módulo de estado (su porcentaje no llega al objeto)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-desc-2',
      puntosActuales: 0,
      tipoTarjeta: 'descuento',
      selloMeta: null,
      nombrePase: 'Club Joyería',
      nombreCliente: 'Lucía',
      apellidoCliente: 'Pérez',
      heroImageUrl: HERO,
      ubicaciones: [],
    });
    expect(obj.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Club Joyería' },
      { id: 'nombre', header: 'NOMBRE', body: 'Lucía' },
      { id: 'apellido', header: 'APELLIDO', body: 'Pérez' },
    ]);
  });

  it('cliente sin apellido: solo el módulo NOMBRE, sin un APELLIDO vacío', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-sin-apellido',
      puntosActuales: 1250,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      nombreCliente: 'José',
      apellidoCliente: '   ',
      ubicaciones: [],
    });
    // Puntos: el estado va como TEXTO, sin separador de miles en Android (aceptado en el spec); el
    // `int` con separador sigue en loyaltyPoints.
    expect(obj.textModulesData).toEqual([
      { id: 'estado', header: 'PUNTOS', body: '1250' },
      { id: 'nombre', header: 'NOMBRE', body: 'José' },
    ]);
    expect(obj.loyaltyPoints).toEqual({ label: 'Puntos', balance: { int: 1250, string: null } });
  });

  it('apellido sin nombre: ni NOMBRE ni APELLIDO (un apellido solo no nombra a nadie)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-sin-nombre',
      puntosActuales: 0,
      tipoTarjeta: 'descuento',
      selloMeta: null,
      nombreCliente: null,
      apellidoCliente: 'Rivera',
      ubicaciones: [],
    });
    expect(obj.textModulesData).toEqual([]);
  });

  it('sellos con la grilla en el hero: sin nombre_pase (taparía los círculos), con el estado "7 de 10"', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-grilla',
      puntosActuales: 7,
      tipoTarjeta: 'sellos',
      selloMeta: 10,
      nombrePase: 'Café Gratis',
      nombreCliente: 'María',
      heroImageUrl: HERO,
      ubicaciones: [],
    });
    expect(obj.textModulesData).toEqual([
      { id: 'estado', header: 'SELLOS', body: '7 de 10' },
      { id: 'nombre', header: 'NOMBRE', body: 'María' },
    ]);
    expect(obj.heroImage).toEqual({ sourceUri: { uri: HERO } });
  });

  // 'grilla' exige que el hero exista: sin él no hay círculos que tapar y la banda queda sin nombre.
  it('sellos con meta pero SIN heroImageUrl: es banda, y el nombre del pase SÍ se manda', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-sellos-sin-hero',
      puntosActuales: 7,
      tipoTarjeta: 'sellos',
      selloMeta: 10,
      nombrePase: 'Café Gratis',
      heroImageUrl: null,
      ubicaciones: [],
    });
    expect(obj.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Café Gratis' },
      { id: 'estado', header: 'SELLOS', body: '7 de 10' },
    ]);
  });

  it('sellos con franja PROPIA (no grilla): sin nombre_pase, con heroImage', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase,
      qrToken: 'tok-sellos-propia',
      puntosActuales: 7,
      tipoTarjeta: 'sellos',
      selloMeta: 10,
      nombrePase: 'Café Gratis',
      stripUrl: FRANJA_PROPIA,
      heroImageUrl: HERO,
      ubicaciones: [],
    });
    expect(obj.textModulesData).toEqual([{ id: 'estado', header: 'SELLOS', body: '7 de 10' }]);
    expect(obj.heroImage).toEqual({ sourceUri: { uri: HERO } });
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
      balance: { string: 'Activa hasta el 12 de octubre de 2026', int: null },
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
    expect(obj.loyaltyPoints!.balance).toEqual({ string: 'Vencida el 3 de agosto de 2026', int: null });
    expect(obj.validTimeInterval).toEqual({ end: { date: '2026-08-03T23:59:59' } });
  });

  it('sin fecha de vigencia NO manda validTimeInterval (una membresía sin activar no está vencida)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia',
    });
    expect(obj.validTimeInterval).toBeUndefined();
    expect(obj.loyaltyPoints!.balance).toEqual({ string: 'Sin activar', int: null });
  });

  it('los tipos SIN vigencia nunca mandan validTimeInterval, aunque la fila traiga una fecha', () => {
    // `tarjetas.vigencia_hasta` solo la usan cupón y membresía; una fecha en una tarjeta de puntos
    // sería basura de una migración vieja, y apagarle el pase al cliente por eso sería peor.
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'puntos', puntosActuales: 40, vigenciaHasta: '2020-01-01',
    });
    expect(obj.validTimeInterval).toBeUndefined();
  });

  // INVERTIDA a propósito (spec 2026-09-17). Antes afirmaba que sin nombre del pase la clave
  // `textModulesData` ni aparecía. Pero el sync hace `patch`, y un campo omitido deja el valor viejo
  // en Google: el dueño que borraba el nombre del pase lo seguía viendo en Android. Ahora la lista
  // viaja SIEMPRE, y sin nombre del pase lleva igual el estado.
  it('el nombre del pase viaja en textModulesData; sin nombre, la lista viaja igual SIN ese módulo', () => {
    const conNombre = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia', nombrePase: 'Socio Oro',
    });
    expect(conNombre.textModulesData).toEqual([
      { id: 'nombre_pase', header: 'Tarjeta', body: 'Socio Oro' },
      { id: 'estado', header: 'MEMBRESÍA', body: 'Sin activar' },
    ]);

    const sinNombre = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'membresia',
    });
    expect(sinNombre.textModulesData).toEqual([{ id: 'estado', header: 'MEMBRESÍA', body: 'Sin activar' }]);
    expect('textModulesData' in sinNombre).toBe(true);
  });

  it('cupón ya usado: lo dice el texto (usadoEn gana sobre la fecha)', () => {
    const obj = construirObjeto('123.tarjeta_xyz', '123.comercio_abc', {
      ...frenteBase, ...base, tipoTarjeta: 'cupon',
      vigenciaHasta: '2026-09-30', usadoEn: '2026-09-05T15:00:00Z',
    });
    expect(obj.loyaltyPoints).toEqual({ label: 'Cupón', balance: { string: 'Ya usado', int: null } });
  });
});
