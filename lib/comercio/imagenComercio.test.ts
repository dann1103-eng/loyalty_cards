import { describe, it, expect } from 'vitest';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenComercio,
  TAMANO_MAXIMO_BYTES,
} from './imagenComercio';

describe('validarImagenSubida', () => {
  it('acepta PNG, JPEG y WebP dentro del límite', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(validarImagenSubida({ type, size: 50_000 })).toBeNull();
    }
  });

  it('rechaza un tipo MIME no permitido', () => {
    for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html']) {
      const err = validarImagenSubida({ type, size: 50_000 });
      expect(err).not.toBeNull();
      expect(err!).toMatch(/formato|tipo/i);
    }
  });

  it('rechaza un archivo más grande que el límite', () => {
    const err = validarImagenSubida({ type: 'image/png', size: TAMANO_MAXIMO_BYTES + 1 });
    expect(err).not.toBeNull();
    expect(err!).toMatch(/grande|tamaño|pesa/i);
  });

  it('rechaza un archivo de tamaño cero', () => {
    const err = validarImagenSubida({ type: 'image/png', size: 0 });
    expect(err).not.toBeNull();
    expect(err!).toMatch(/vacío|vacio|archivo/i);
  });
});

describe('extensionDeMime', () => {
  it('mapea cada MIME permitido a su extensión', () => {
    expect(extensionDeMime('image/png')).toBe('png');
    expect(extensionDeMime('image/jpeg')).toBe('jpg');
    expect(extensionDeMime('image/webp')).toBe('webp');
  });
});

describe('rutaImagenComercio', () => {
  it('compone la ruta {comercioId}/{campo}.{ext}', () => {
    expect(rutaImagenComercio('abc-123', 'logo', 'png')).toBe('abc-123/logo.png');
    expect(rutaImagenComercio('abc-123', 'sello_icono', 'webp')).toBe('abc-123/sello_icono.webp');
  });
});
