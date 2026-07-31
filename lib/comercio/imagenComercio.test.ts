import { describe, it, expect } from 'vitest';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenComercio,
  rutaImagenPrograma,
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

describe('rutaImagenPrograma', () => {
  it('lleva el programaId en el path, bajo la carpeta del comercio', () => {
    expect(rutaImagenPrograma('abc-123', 'prog-9', 'logo', 'png')).toBe(
      'abc-123/programas/prog-9/logo.png',
    );
  });

  // LA prueba de esta tarea. La subida usa `upsert: true`, así que dos rutas iguales significan que
  // el segundo archivo PISA al primero. Si la ruta del programa no llevara su id, subirle un logo
  // al programa secundario borraría el logo del COMERCIO — y el dueño vería desaparecer la marca de
  // su negocio sin ningún error.
  it('NUNCA coincide con la ruta del comercio para el mismo campo', () => {
    const delComercio = rutaImagenComercio('abc-123', 'logo', 'png');
    const delPrograma = rutaImagenPrograma('abc-123', 'prog-9', 'logo', 'png');
    expect(delPrograma).not.toBe(delComercio);
  });

  it('dos programas del mismo comercio no se pisan entre sí', () => {
    const a = rutaImagenPrograma('abc-123', 'prog-A', 'logo', 'png');
    const b = rutaImagenPrograma('abc-123', 'prog-B', 'logo', 'png');
    expect(a).not.toBe(b);
  });

  it('el comercioId sigue siendo la carpeta raíz: lo pone el gate, no el formulario', () => {
    // Mismo criterio que rutaImagenRecompensa. Conocer el id de un programa ajeno no alcanza para
    // escribir en la carpeta de otro comercio.
    expect(rutaImagenPrograma('abc-123', 'prog-9', 'hero', 'jpg').startsWith('abc-123/')).toBe(true);
  });
});
