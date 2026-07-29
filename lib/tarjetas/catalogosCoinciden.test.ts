import { describe, it, expect } from 'vitest';
import { TIPOS } from './tipos';
import { TIPOS_TARJETA } from '../comercios/guardarComercio';

// Hay DOS vistas de los mismos ocho tipos:
//   - TIPOS_TARJETA (lib/comercios/guardarComercio.ts): etiquetas y descripciones para el select de FM.
//   - TIPOS (lib/tarjetas/tipos.ts): la mecánica — si el contador es dinero, si exige monto, qué
//     hace el cajero al escanear.
//
// Divergen en silencio con facilidad: agregar un tipo en una y olvidarse de la otra deja o un tipo
// que FM puede asignar pero ninguna pantalla sabe dibujar, o un motor construido que nadie puede
// elegir. Esta prueba es el candado.
describe('los dos catálogos de tipos coinciden', () => {
  it('tienen exactamente los mismos valores', () => {
    const deFm = TIPOS_TARJETA.map((t) => t.valor).sort();
    const deMecanica = TIPOS.map((t) => t.valor).sort();
    expect(deMecanica).toEqual(deFm);
  });

  it('todo tipo que FM puede asignar tiene su mecánica construida', () => {
    // `disponible: true` es una promesa al operador: "esto funciona". Si un tipo está disponible
    // pero no tiene entrada en TIPOS, el escáner no sabría qué botón mostrar.
    const disponibles = TIPOS_TARJETA.filter((t) => t.disponible).map((t) => t.valor);
    for (const valor of disponibles) {
      expect(TIPOS.some((t) => t.valor === valor), `"${valor}" está disponible pero no tiene mecánica`).toBe(true);
    }
  });
});
