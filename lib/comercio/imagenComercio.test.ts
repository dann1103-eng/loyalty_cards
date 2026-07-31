import { describe, it, expect } from 'vitest';
import {
  validarImagenSubida,
  extensionDeMime,
  rutaImagenCartel,
  rutaImagenComercio,
  rutaImagenPrograma,
  rutaImagenRecompensa,
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

describe('rutaImagenCartel', () => {
  it('compone la ruta {comercioId}/carteles/{programaId}.{ext}', () => {
    expect(rutaImagenCartel('abc-123', 'prog-9', 'png')).toBe('abc-123/carteles/prog-9.png');
  });

  // LA prueba de esta ruta. rutaImagenCartel y rutaImagenRecompensa tienen la MISMA firma
  // (comercioId, id, ext): confundirlas en un call-site no lo atrapa el type checker, y como la
  // subida usa `upsert: true`, guardar el logo de un cartel con la ruta de recompensa PISARÍA la
  // foto de un premio (o al revés) sin un solo error. El segmento de carpeta es lo único que las
  // separa — por eso se asserta explícitamente que nunca coinciden, ni con el mismo id.
  it('NUNCA coincide con la ruta de una recompensa que tuviera el mismo id', () => {
    const delCartel = rutaImagenCartel('abc-123', 'mismo-id', 'png');
    const deLaRecompensa = rutaImagenRecompensa('abc-123', 'mismo-id', 'png');
    expect(delCartel).not.toBe(deLaRecompensa);
  });

  it('NUNCA coincide con la ruta de branding del comercio ni con la del programa', () => {
    const delCartel = rutaImagenCartel('abc-123', 'prog-9', 'png');
    expect(delCartel).not.toBe(rutaImagenComercio('abc-123', 'logo', 'png'));
    expect(delCartel).not.toBe(rutaImagenPrograma('abc-123', 'prog-9', 'logo', 'png'));
  });

  it('dos programas del mismo comercio no se pisan el cartel entre sí', () => {
    expect(rutaImagenCartel('abc-123', 'prog-A', 'png')).not.toBe(
      rutaImagenCartel('abc-123', 'prog-B', 'png'),
    );
  });

  it('el comercioId sigue siendo la carpeta raíz: lo pone el gate, no el formulario', () => {
    expect(rutaImagenCartel('abc-123', 'prog-9', 'webp').startsWith('abc-123/')).toBe(true);
  });
});
