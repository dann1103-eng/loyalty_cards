import { describe, it, expect } from 'vitest';
import {
  brandingEfectivo,
  necesitaClasePropia,
  reversoEfectivo,
  type BrandingBase,
  type ReversoBase,
} from './brandingEfectivo';
import { ENCUADRE_POR_DEFECTO } from './encuadreFranja';

// Módulo PURO. Es la única definición de "qué branding ve el cliente" y la comparten los NUEVE
// consumidores (pase de Apple, clase y objeto de Google, JWT de guardado, portal, la ruta que
// dibuja la imagen, y los tres de propagación). Si cada uno hiciera su propio `??`, uno se
// olvidaría — ya pasó dos veces en julio de 2026.
const COMERCIO: BrandingBase = {
  colorFondo: 'rgb(10, 10, 10)',
  colorTexto: 'rgb(255, 255, 255)',
  colorLabel: 'rgb(200, 200, 200)',
  logoUrl: 'https://ejemplo.com/logo-comercio.png',
  heroUrl: 'https://ejemplo.com/hero-comercio.png',
  stripUrl: null,
  selloIconoUrl: 'https://ejemplo.com/sello-comercio.png',
  difuminadoFranja: 'medio',
  encuadreFranja: { modo: 'completa', focoX: 10, focoY: 90, zoom: 150 },
};

describe('brandingEfectivo', () => {
  it('sin programa: devuelve tal cual el branding del comercio', () => {
    expect(brandingEfectivo(COMERCIO, null)).toEqual(COMERCIO);
  });

  it('programa con branding_propio APAGADO: hereda todo aunque tenga campos cargados', () => {
    // El booleano manda sobre los campos. Así, apagar el branding propio no obliga al dueño a
    // limpiar cada columna, y volver a encenderlo le devuelve lo que había configurado.
    const resultado = brandingEfectivo(COMERCIO, {
      brandingPropio: false,
      colorFondo: 'rgb(255, 0, 0)',
      logoUrl: 'https://ejemplo.com/logo-programa.png',
    });
    expect(resultado).toEqual(COMERCIO);
  });

  it('herencia CAMPO POR CAMPO: lo definido pisa, lo null hereda', () => {
    const resultado = brandingEfectivo(COMERCIO, {
      brandingPropio: true,
      colorFondo: 'rgb(255, 0, 0)',
      logoUrl: 'https://ejemplo.com/logo-programa.png',
      // el resto sin definir
    });
    expect(resultado.colorFondo).toBe('rgb(255, 0, 0)');
    expect(resultado.logoUrl).toBe('https://ejemplo.com/logo-programa.png');
    // …y todo lo demás sigue viniendo del comercio.
    expect(resultado.colorTexto).toBe(COMERCIO.colorTexto);
    expect(resultado.heroUrl).toBe(COMERCIO.heroUrl);
    expect(resultado.selloIconoUrl).toBe(COMERCIO.selloIconoUrl);
    expect(resultado.difuminadoFranja).toBe(COMERCIO.difuminadoFranja);
  });

  it('un campo del comercio que es null y el programa tampoco define: queda null', () => {
    const resultado = brandingEfectivo(COMERCIO, { brandingPropio: true, colorFondo: 'rgb(1,2,3)' });
    expect(resultado.stripUrl).toBeNull();
  });

  // EL ENCUADRE VIAJA CON LA FOTO, no campo por campo como los colores: la posición de una foto solo
  // tiene sentido para ESA foto, y heredar el foco del negocio sobre otra foto daría siempre un
  // resultado sin sentido (decisión 4 del spec).
  it('encuadre: programa CON foto propia usa su encuadre propio', () => {
    const propio = { modo: 'llenar' as const, focoX: 0, focoY: 0, zoom: 200 };
    const r = brandingEfectivo(COMERCIO, { brandingPropio: true, heroUrl: 'https://ejemplo.com/hero-programa.png', encuadreFranja: propio });
    expect(r.encuadreFranja).toEqual(propio);
  });

  it('encuadre: programa CON foto propia y sin encuadre tocado usa el DEFAULT, no el del negocio', () => {
    // MUTACIÓN: `programa.encuadreFranja ?? comercio.encuadreFranja` pone el foco de la foto del
    // negocio sobre la foto nueva del programa.
    const r = brandingEfectivo(COMERCIO, { brandingPropio: true, heroUrl: 'https://ejemplo.com/hero-programa.png', encuadreFranja: null });
    expect(r.encuadreFranja).toEqual(ENCUADRE_POR_DEFECTO);
  });

  it('encuadre: programa que HEREDA la foto hereda también el encuadre, aunque tenga uno guardado', () => {
    // MUTACIÓN: la misma `programa.encuadreFranja ?? comercio.encuadreFranja` pondría el encuadre
    // guardado (de una foto anterior del programa) sobre la foto del negocio.
    const r = brandingEfectivo(COMERCIO, { brandingPropio: true, colorFondo: 'rgb(1,2,3)', encuadreFranja: { modo: 'llenar', focoX: 0, focoY: 0, zoom: 300 } });
    expect(r.heroUrl).toBe(COMERCIO.heroUrl);
    expect(r.encuadreFranja).toEqual(COMERCIO.encuadreFranja);
  });

  it('encuadre: con branding_propio APAGADO se ignora el encuadre propio (y la foto propia)', () => {
    const r = brandingEfectivo(COMERCIO, {
      brandingPropio: false,
      heroUrl: 'https://ejemplo.com/hero-programa.png',
      encuadreFranja: { modo: 'llenar', focoX: 0, focoY: 0, zoom: 300 },
    });
    expect(r.encuadreFranja).toEqual(COMERCIO.encuadreFranja);
  });
});

// La regla que decide si se crea un recurso PERMANENTE e irreversible en el emisor de Google.
// construirClase solo manda color_fondo, logo_url y hero_url a la LoyaltyClass; los otros cinco
// campos viven en el .pkpass y en el heroImage del objeto, que ya es por tarjeta. Crear una clase
// por un cambio de ícono de sello sería basura permanente que nadie puede borrar.
describe('necesitaClasePropia', () => {
  it('sin programa: no', () => {
    expect(necesitaClasePropia(null)).toBe(false);
  });

  it('branding propio apagado: no, aunque tenga los tres campos cargados', () => {
    expect(
      necesitaClasePropia({
        brandingPropio: false,
        colorFondo: 'rgb(1,2,3)',
        logoUrl: 'x',
        heroUrl: 'y',
      }),
    ).toBe(false);
  });

  it('branding propio encendido pero SIN ninguno de los tres campos de Google: NO crea clase', () => {
    // Este es el caso que justifica la regla fina. Un dueño que solo cambia el ícono del sello o el
    // color de etiqueta no debe generar una clase permanente: esos campos no llegan a la clase.
    expect(
      necesitaClasePropia({ brandingPropio: true, colorFondo: null, logoUrl: null, heroUrl: null }),
    ).toBe(false);
  });

  it('cualquiera de los tres alcanza para necesitar clase propia', () => {
    const base = { brandingPropio: true, colorFondo: null, logoUrl: null, heroUrl: null };
    expect(necesitaClasePropia({ ...base, colorFondo: 'rgb(1,2,3)' })).toBe(true);
    expect(necesitaClasePropia({ ...base, logoUrl: 'https://ejemplo.com/l.png' })).toBe(true);
    expect(necesitaClasePropia({ ...base, heroUrl: 'https://ejemplo.com/h.png' })).toBe(true);
  });
});

// El hermano de brandingEfectivo para el REVERSO (migración 0029). Misma regla —el booleano manda
// sobre los campos, null es "heredá"— con una diferencia que sí muerde: mostrarComoFunciona es un
// BOOLEANO, y ahí `||` en lugar de `??` haría que un programa que apagó la sección la viera
// encendida porque el comercio la tiene encendida.
const REVERSO_COMERCIO: ReversoBase = {
  terminosUso: 'Términos del negocio.',
  redInstagram: 'https://instagram.com/negocio',
  redFacebook: 'https://facebook.com/negocio',
  redWhatsapp: 'https://wa.me/50370000000',
  sitioWeb: 'https://negocio.com',
  mostrarComoFunciona: true,
};

describe('reversoEfectivo', () => {
  it('sin programa: devuelve tal cual el reverso del comercio', () => {
    expect(reversoEfectivo(REVERSO_COMERCIO, null)).toEqual(REVERSO_COMERCIO);
  });

  it('programa con reverso_propio APAGADO: hereda todo aunque tenga campos cargados', () => {
    const resultado = reversoEfectivo(REVERSO_COMERCIO, {
      reversoPropio: false,
      terminosUso: 'Términos del cupón.',
      mostrarComoFunciona: false,
    });
    expect(resultado).toEqual(REVERSO_COMERCIO);
  });

  it('herencia CAMPO POR CAMPO: lo definido pisa, lo null hereda', () => {
    const resultado = reversoEfectivo(REVERSO_COMERCIO, {
      reversoPropio: true,
      terminosUso: 'Términos del cupón.',
      redInstagram: 'https://instagram.com/cupon',
    });
    expect(resultado.terminosUso).toBe('Términos del cupón.');
    expect(resultado.redInstagram).toBe('https://instagram.com/cupon');
    expect(resultado.redFacebook).toBe(REVERSO_COMERCIO.redFacebook);
    expect(resultado.redWhatsapp).toBe(REVERSO_COMERCIO.redWhatsapp);
    expect(resultado.sitioWeb).toBe(REVERSO_COMERCIO.sitioWeb);
    expect(resultado.mostrarComoFunciona).toBe(true);
  });

  // LA prueba de este módulo. `false` es un valor ELEGIDO por el dueño ("no quiero la sección en
  // esta tarjeta"), no una ausencia: con `||` se lo tragaría el true del comercio y el cliente
  // vería en el cupón una sección que el dueño apagó.
  it('mostrarComoFunciona en false NO hereda el true del comercio', () => {
    const resultado = reversoEfectivo(REVERSO_COMERCIO, {
      reversoPropio: true,
      mostrarComoFunciona: false,
    });
    expect(resultado.mostrarComoFunciona, 'false es una decisión, no una ausencia').toBe(false);
  });

  it('mostrarComoFunciona en null SÍ hereda el del comercio', () => {
    const resultado = reversoEfectivo(REVERSO_COMERCIO, {
      reversoPropio: true,
      mostrarComoFunciona: null,
      terminosUso: 'Términos del cupón.',
    });
    expect(resultado.mostrarComoFunciona).toBe(true);
  });

  it('un campo del comercio que es null y el programa tampoco define: queda null', () => {
    const sinRedes: ReversoBase = { ...REVERSO_COMERCIO, redFacebook: null };
    const resultado = reversoEfectivo(sinRedes, {
      reversoPropio: true,
      terminosUso: 'Términos del cupón.',
    });
    expect(resultado.redFacebook).toBeNull();
  });
});
