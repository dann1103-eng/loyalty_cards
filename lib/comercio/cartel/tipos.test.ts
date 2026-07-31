import { describe, expect, it } from 'vitest';
import { DIMENSIONES_CARTEL, esPlantillaCartel } from './tipos';

describe('DIMENSIONES_CARTEL', () => {
  it('sticker: 10x10cm da 1181x1181px a 300dpi', () => {
    expect(DIMENSIONES_CARTEL.sticker.px).toEqual({ ancho: 1181, alto: 1181 });
  });

  it('mostrador: A5 (148x210mm) da 1748x2480px a 300dpi', () => {
    expect(DIMENSIONES_CARTEL.mostrador.px).toEqual({ ancho: 1748, alto: 2480 });
  });

  it('sticker: 283x283pt a 72pt/pulgada', () => {
    expect(DIMENSIONES_CARTEL.sticker.pt).toEqual({ ancho: 283.46, alto: 283.46 });
  });

  it('mostrador: 419.53x595.28pt a 72pt/pulgada', () => {
    expect(DIMENSIONES_CARTEL.mostrador.pt).toEqual({ ancho: 419.53, alto: 595.28 });
  });

  it('el viewBox del mostrador conserva la proporción física (148:210)', () => {
    const { ancho, alto } = DIMENSIONES_CARTEL.mostrador.viewBox;
    expect(alto / ancho).toBeCloseTo(210 / 148, 3);
  });
});

describe('esPlantillaCartel', () => {
  it('acepta las 3 plantillas válidas', () => {
    expect(esPlantillaCartel('centrado')).toBe(true);
    expect(esPlantillaCartel('split')).toBe(true);
    expect(esPlantillaCartel('foto')).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(esPlantillaCartel('libre')).toBe(false);
    expect(esPlantillaCartel(null)).toBe(false);
    expect(esPlantillaCartel(undefined)).toBe(false);
  });
});
