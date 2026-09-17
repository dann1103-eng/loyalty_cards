import { describe, it, expect } from 'vitest';
import { validarNombreRegistro } from './validarNombreRegistro';

// La validación de nombre y apellido del registro público (/api/registro). Vivía dentro de la ruta,
// que no tiene prueba; salió a una función pura para poder fijar los mensajes exactos que ve el
// cliente final y el tope de 120, que para el apellido es además el CHECK de la 0036: lo que pase de
// acá y no entre en la columna tumba el alta entera con 23514 en vez de un 400 legible.
//
// Mutaciones verificadas (2026-09-17), cada una rompe exactamente una prueba de este archivo:
//   - tope de 121 para el apellido (`apellidoLimpio.length > 121`) → falla "un apellido de 121
//     caracteres es inválido": `expected { ok: true, nombre: 'María', …(1) } to deeply equal
//     { ok: false, …(1) }` (el diff: esperaba `"error": "Apellido inválido"`, recibió `ok: true`).
//   - tope de 121 para el nombre (`nombreLimpio.length > 121`) → falla "un nombre de 121
//     caracteres es inválido": `expected { ok: true, …(2) } to deeply equal { ok: false, error:
//     'Nombre inválido' }`.
//   - sin `!apellido` (un apellido '' pasa el primer control) → falla "un apellido vacío":
//     esperaba `"error": "Faltan datos"`, recibió `"error": "Apellido inválido"`.

const DE_120 = 'a'.repeat(120);
const DE_121 = 'a'.repeat(121);

describe('validarNombreRegistro', () => {
  it('devuelve los dos recortados', () => {
    expect(validarNombreRegistro({ nombre: '  María ', apellido: ' Rivera  ' })).toEqual({
      ok: true,
      nombre: 'María',
      apellido: 'Rivera',
    });
  });

  describe('faltan datos: el mismo control para los dos', () => {
    it('un nombre ausente', () => {
      expect(validarNombreRegistro({ nombre: undefined, apellido: 'Rivera' })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });

    it('un nombre que no es texto', () => {
      expect(validarNombreRegistro({ nombre: 42, apellido: 'Rivera' })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });

    it('un nombre vacío', () => {
      expect(validarNombreRegistro({ nombre: '', apellido: 'Rivera' })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });

    it('un apellido ausente (un formulario viejo que no lo manda)', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: undefined })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });

    it('un apellido que no es texto', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: null })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });

    it('un apellido vacío', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: '' })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });

    it('faltar gana sobre ser inválido, como en la ruta de siempre', () => {
      expect(validarNombreRegistro({ nombre: '   ', apellido: undefined })).toEqual({
        ok: false,
        error: 'Faltan datos',
      });
    });
  });

  describe('nombre inválido', () => {
    it('solo espacios', () => {
      expect(validarNombreRegistro({ nombre: '   ', apellido: 'Rivera' })).toEqual({
        ok: false,
        error: 'Nombre inválido',
      });
    });

    it('un nombre de 121 caracteres es inválido', () => {
      expect(validarNombreRegistro({ nombre: DE_121, apellido: 'Rivera' })).toEqual({
        ok: false,
        error: 'Nombre inválido',
      });
    });

    it('un nombre de 120 caracteres entra', () => {
      expect(validarNombreRegistro({ nombre: DE_120, apellido: 'Rivera' })).toEqual({
        ok: true,
        nombre: DE_120,
        apellido: 'Rivera',
      });
    });

    it('el nombre se mide recortado', () => {
      expect(validarNombreRegistro({ nombre: ` ${DE_120} `, apellido: 'Rivera' })).toEqual({
        ok: true,
        nombre: DE_120,
        apellido: 'Rivera',
      });
    });

    it('con los dos inválidos se nombra primero el nombre, en el orden del formulario', () => {
      expect(validarNombreRegistro({ nombre: '   ', apellido: '   ' })).toEqual({
        ok: false,
        error: 'Nombre inválido',
      });
    });
  });

  describe('apellido inválido', () => {
    it('solo espacios', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: '   ' })).toEqual({
        ok: false,
        error: 'Apellido inválido',
      });
    });

    it('un apellido de 121 caracteres es inválido', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: DE_121 })).toEqual({
        ok: false,
        error: 'Apellido inválido',
      });
    });

    it('un apellido de 120 caracteres entra', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: DE_120 })).toEqual({
        ok: true,
        nombre: 'María',
        apellido: DE_120,
      });
    });

    it('el apellido se mide recortado', () => {
      expect(validarNombreRegistro({ nombre: 'María', apellido: `  ${DE_120}  ` })).toEqual({
        ok: true,
        nombre: 'María',
        apellido: DE_120,
      });
    });
  });
});
