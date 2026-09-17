import { describe, it, expect } from 'vitest';
import { nombreCompleto } from './nombreCompleto';

// El apellido existe desde la 0036. Los clientes que se registraron antes lo tienen en null, y
// muchos de ellos escribieron el nombre completo en "Nombre" (el campo usaba autocomplete="name"):
// a esos hay que mostrarles lo que escribieron, sin agregarles nada.

describe('nombreCompleto', () => {
  it('une nombre y apellido con un espacio', () => {
    expect(nombreCompleto('María', 'Rivera')).toBe('María Rivera');
  });

  it('con apellido null devuelve el nombre solo', () => {
    expect(nombreCompleto('María José López', null)).toBe('María José López');
  });

  it('con apellido en blanco devuelve el nombre solo, sin espacio colgando', () => {
    expect(nombreCompleto('María', '')).toBe('María');
    expect(nombreCompleto('María', '   ')).toBe('María');
  });

  it('recorta el apellido antes de unirlo', () => {
    expect(nombreCompleto('María', '  Rivera ')).toBe('María Rivera');
  });
});
