import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { esLogoAncho, versionLogoClase, logosDeClase, resolverLogosClase } from './logosClase';

// La medición se mockea: acá se prueba QUÉ se decide con las medidas, no la descarga (logoRemoto.test.ts).
//
// MUTACIONES corridas el 2026-09-23 (cada una restaurada y el archivo comparado con el índice de git):
//   (a) OMITIR la clave en vez de mandar null para un logo medido no ancho, en logosDeClase:
//       `if (!esLogoAncho(medidas)) return { programLogo };` → FALLA "medido y NO ancho →
//       wideProgramLogo PRESENTE con null (borra uno anterior)" con `expected false to be true`. Caen
//       también, con el mismo mensaje, las pruebas del null en syncClase, syncClasePrograma y
//       linkGuardar (4 en total).
//   (b) Chequeo de PRESENCIA en vez de esBaseUrlPublica, en baseParaImagenesGoogle (baseUrlPublica.ts):
//       `if (!base) return null;` → FALLAN "con la base de desarrollo (http://localhost:3000) → el logo
//       crudo y sin logo ancho, nunca localhost" (`expected { …(2) } to deeply equal { Object
//       (programLogo) }`) y "sin base pública NO mide (ni descarga)…", más tres de heroUrl.test.ts y una
//       de syncClase.test.ts (6 en total).
//   (c) Umbral 1.2 en vez de 1.6 → FALLAN "un 4:3 y un 3:2 NO son anchos" y "el borde del umbral
//       (1.6:1)…", las dos con `expected true to be false`.
//   (d) `>` en vez de `>=` en esLogoAncho → FALLA "el borde del umbral (1.6:1)…" con `expected false to
//       be true`.
//   (e) Medir SIEMPRE en resolverLogosClase, sin mirar la base → FALLAN "sin base pública NO mide (ni
//       descarga)…" y la de desarrollo de syncClase.test.ts, con `expected "vi.fn()" to not be called at
//       all, but actually been called 1 times`.
//   (f) El color fuera del hash de versionLogoClase → FALLAN "cambia con el logo (su ?v= del bucket) y
//       con el color de fondo" (`expected 'edad6e611917' not to be 'edad6e611917'`) y "el ?v= del
//       programLogo cambia con el logo y con el color".
const medidasLogoMock = vi.fn();
vi.mock('./logoRemoto', () => ({
  medidasLogo: (...args: unknown[]) => medidasLogoMock(...args),
}));

const ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;
const PRODUCCION = 'https://www.cardly-sv.site';

beforeEach(() => {
  medidasLogoMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = ORIGINAL;
});

const MARCA = { logoUrl: 'https://ejemplo.com/storage/logo.png?v=1727000000', colorFondo: 'rgb(36, 24, 18)' };
const ANCHO = { ancho: 480, alto: 160 }; // 3:1, el de Pulso
const CUADRADO = { ancho: 300, alto: 300 };

describe('esLogoAncho', () => {
  it('3:1 (Pulso) es ancho; cuadrado y vertical no', () => {
    expect(esLogoAncho(ANCHO)).toBe(true);
    expect(esLogoAncho(CUADRADO)).toBe(false);
    expect(esLogoAncho({ ancho: 100, alto: 300 })).toBe(false);
  });

  // Un 4:3 y un 3:2 dentro del círculo ya se ven grandes, y el logo ancho les quitaría la cabecera con
  // el nombre del negocio.
  it('un 4:3 y un 3:2 NO son anchos', () => {
    expect(esLogoAncho({ ancho: 400, alto: 300 })).toBe(false);
    expect(esLogoAncho({ ancho: 300, alto: 200 })).toBe(false);
  });

  it('el borde del umbral (1.6:1): 16:10 justo es ancho, 1.59 no', () => {
    expect(esLogoAncho({ ancho: 160, alto: 100 })).toBe(true);
    expect(esLogoAncho({ ancho: 159, alto: 100 })).toBe(false);
  });

  it('medidas degeneradas (alto 0) no son ancho, y no dividen por cero', () => {
    expect(esLogoAncho({ ancho: 100, alto: 0 })).toBe(false);
  });
});

describe('versionLogoClase', () => {
  it('es determinística y corta (12 hex)', () => {
    expect(versionLogoClase(MARCA)).toBe(versionLogoClase({ ...MARCA }));
    expect(versionLogoClase(MARCA)).toMatch(/^[0-9a-f]{12}$/);
  });

  // Google cachea por URL: si re-subir el logo o cambiar el color no cambiara la URL, Android mostraría
  // el logo viejo para siempre.
  it('cambia con el logo (su ?v= del bucket) y con el color de fondo', () => {
    const base = versionLogoClase(MARCA);
    expect(versionLogoClase({ ...MARCA, logoUrl: 'https://ejemplo.com/storage/logo.png?v=1727999999' })).not.toBe(base);
    expect(versionLogoClase({ ...MARCA, colorFondo: 'rgb(1, 2, 3)' })).not.toBe(base);
    expect(versionLogoClase({ ...MARCA, colorFondo: null })).not.toBe(base);
  });
});

describe('logosDeClase', () => {
  it('clase del comercio: programLogo a la ruta compuesta, con la versión y sin ?programa=', () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    const logos = logosDeClase('com-1', null, MARCA, CUADRADO);
    expect(logos.programLogo).toBe(`${PRODUCCION}/api/comercios/com-1/logo.png?v=${versionLogoClase(MARCA)}`);
  });

  it('clase de un programa: lleva ?programa= ANTES de la versión', () => {
    process.env.NEXT_PUBLIC_BASE_URL = `${PRODUCCION}/`;
    const logos = logosDeClase('com-1', 'prog-9', MARCA, CUADRADO);
    expect(logos.programLogo).toBe(`${PRODUCCION}/api/comercios/com-1/logo.png?programa=prog-9&v=${versionLogoClase(MARCA)}`);
  });

  it('el ?v= del programLogo cambia con el logo y con el color', () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    const base = logosDeClase('com-1', null, MARCA, CUADRADO).programLogo;
    expect(logosDeClase('com-1', null, { ...MARCA, logoUrl: 'https://ejemplo.com/otro.png' }, CUADRADO).programLogo).not.toBe(base);
    expect(logosDeClase('com-1', null, { ...MARCA, colorFondo: 'rgb(1, 2, 3)' }, CUADRADO).programLogo).not.toBe(base);
  });

  it('logo ANCHO → wideProgramLogo a la ruta del logo ancho, misma versión y misma rama', () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    const v = versionLogoClase(MARCA);
    expect(logosDeClase('com-1', null, MARCA, ANCHO).wideProgramLogo).toBe(`${PRODUCCION}/api/comercios/com-1/logo-ancho.png?v=${v}`);
    expect(logosDeClase('com-1', 'prog-9', MARCA, ANCHO).wideProgramLogo).toBe(
      `${PRODUCCION}/api/comercios/com-1/logo-ancho.png?programa=prog-9&v=${v}`,
    );
  });

  // El `patch` conserva lo que se omite: sin el null, el comercio que cambia su logo ancho por uno
  // cuadrado seguiría viendo el ancho viejo en cada Android.
  it('medido y NO ancho → wideProgramLogo PRESENTE con null (borra uno anterior)', () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    const logos = logosDeClase('com-1', null, MARCA, CUADRADO);
    expect('wideProgramLogo' in logos).toBe(true);
    expect(logos.wideProgramLogo).toBeNull();
  });

  // Un error pasajero de medición no agrega ni quita el logo ancho.
  it('sin medidas → la clave wideProgramLogo se OMITE (ni URL ni null)', () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    const logos = logosDeClase('com-1', null, MARCA, null);
    expect('wideProgramLogo' in logos).toBe(false);
    expect(logos.programLogo).toContain('/logo.png?');
  });

  it('sin NEXT_PUBLIC_BASE_URL → el logo crudo y sin logo ancho, aunque el logo sea ancho', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(logosDeClase('com-1', 'prog-9', MARCA, ANCHO)).toEqual({ programLogo: MARCA.logoUrl });
  });

  // EL caso del dev server: una imagen de la clase apuntando a localhost hace que Google rechace el
  // patch ENTERO (`400 Image cannot be loaded`).
  it('con la base de desarrollo (http://localhost:3000) → el logo crudo y sin logo ancho, nunca localhost', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    expect(logosDeClase('com-1', null, MARCA, ANCHO)).toEqual({ programLogo: MARCA.logoUrl });
    expect(logosDeClase('com-1', null, MARCA, CUADRADO)).toEqual({ programLogo: MARCA.logoUrl });
  });
});

describe('resolverLogosClase', () => {
  it('con base pública: mide el logo de ESA marca y decide con las medidas', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    medidasLogoMock.mockResolvedValue(ANCHO);
    const logos = await resolverLogosClase('com-1', null, MARCA);
    expect(medidasLogoMock).toHaveBeenCalledWith(MARCA.logoUrl);
    expect(logos.wideProgramLogo).toContain('/logo-ancho.png?');
  });

  it('medición fallida (null) → la clave se omite', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = PRODUCCION;
    medidasLogoMock.mockResolvedValue(null);
    expect('wideProgramLogo' in (await resolverLogosClase('com-1', null, MARCA))).toBe(false);
  });

  // Sin base pública no hay logo ancho posible: medir sería una descarga de hasta 2 s en cada registro
  // de cliente para nada.
  it('sin base pública NO mide (ni descarga) y devuelve el logo crudo', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
    expect(await resolverLogosClase('com-1', null, MARCA)).toEqual({ programLogo: MARCA.logoUrl });
    expect(medidasLogoMock).not.toHaveBeenCalled();
  });
});
