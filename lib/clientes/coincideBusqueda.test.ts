import { describe, it, expect } from 'vitest';
import { coincideBusqueda } from './coincideBusqueda';

// El buscador de /comercio/clientes. Vivía como un filtro en línea dentro de la página, donde no
// se podía probar; salió acá cuando el apellido (0036) empezó a ser parte de lo que se busca.

const maria = { nombre: 'María', apellido: 'Rivera', telefono: '+50377771234' };
const anterior = { nombre: 'Ana López', apellido: null, telefono: '+50370000000' };

describe('coincideBusqueda', () => {
  it('encuentra por nombre, sin importar mayúsculas', () => {
    expect(coincideBusqueda(maria, 'maría')).toBe(true);
    expect(coincideBusqueda(maria, 'MAR')).toBe(true);
  });

  it('encuentra por apellido', () => {
    // MUTACIÓN (2026-09-17): sacar `cliente?.apellido` de las partes del texto buscado deja el
    // texto en "María +50377771234" y esta prueba falla con "expected false to be true" en la
    // primera línea. Es la línea que la prueba dice proteger.
    expect(coincideBusqueda(maria, 'rivera')).toBe(true);
    // Nombre y apellido seguidos, como lo tipea el dueño.
    expect(coincideBusqueda(maria, 'María Rivera')).toBe(true);
  });

  it('encuentra por teléfono', () => {
    expect(coincideBusqueda(maria, '7777')).toBe(true);
    expect(coincideBusqueda(maria, '+50377771234')).toBe(true);
  });

  it('no encuentra lo que no está', () => {
    expect(coincideBusqueda(maria, 'Gómez')).toBe(false);
    expect(coincideBusqueda(maria, '6666')).toBe(false);
  });

  it('con la búsqueda vacía o en blanco deja pasar a todos', () => {
    expect(coincideBusqueda(maria, '')).toBe(true);
    expect(coincideBusqueda(maria, '   ')).toBe(true);
    // Incluso una tarjeta cuyo join a clientes vino vacío: sin búsqueda no se filtra nada.
    expect(coincideBusqueda(null, '')).toBe(true);
  });

  it('un cliente sin apellido se busca igual que antes de la 0036', () => {
    // El texto de antes era "nombre teléfono" con UN espacio. Si el apellido null dejara un hueco
    // doble, "López +503…" dejaría de encontrar a quien sí encontraba.
    // MUTACIÓN (2026-09-17): meter el apellido como `cliente?.apellido ?? ''` hace fallar la
    // primera línea con "expected false to be true".
    expect(coincideBusqueda(anterior, 'López +50370000000')).toBe(true);
    expect(coincideBusqueda(anterior, 'ana')).toBe(true);
  });

  it('una tarjeta sin cliente no coincide con una búsqueda', () => {
    expect(coincideBusqueda(null, 'ana')).toBe(false);
  });
});
