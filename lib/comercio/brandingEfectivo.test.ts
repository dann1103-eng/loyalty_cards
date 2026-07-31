import { describe, it, expect } from 'vitest';
import { brandingEfectivo, necesitaClasePropia, type BrandingBase } from './brandingEfectivo';

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
