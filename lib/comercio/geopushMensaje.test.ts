import { describe, it, expect } from 'vitest';
import { resolverMensajeCercania } from './geopush';

// Función pura. Decide QUÉ texto se graba dentro del pase hoy.

const HOY = '2026-07-28';
const BASE = 'Pasá por tu hotdog y acumulá puntos';
const CAMPANA = '2x1 en hotdogs este fin de semana';

describe('resolverMensajeCercania', () => {
  it('la campaña vigente TAPA al mensaje base', () => {
    expect(resolverMensajeCercania(BASE, CAMPANA, '2026-07-30', HOY)).toBe(CAMPANA);
  });

  it('el día del vencimiento la campaña TODAVÍA se muestra', () => {
    // Tiene que coincidir con lo que dice la pantalla ("se muestra hasta el 28") y con el trabajo
    // diario que la apaga. Si acá muriera un día antes, el dueño vería su promo desaparecer el día
    // que más la necesita.
    expect(resolverMensajeCercania(BASE, CAMPANA, HOY, HOY)).toBe(CAMPANA);
  });

  it('al día siguiente vuelve solo el mensaje base', () => {
    expect(resolverMensajeCercania(BASE, CAMPANA, '2026-07-27', HOY)).toBe(BASE);
  });

  it('sin campaña se usa el base', () => {
    expect(resolverMensajeCercania(BASE, null, null, HOY)).toBe(BASE);
  });

  it('una campaña a medias no se muestra', () => {
    // La BD impide guardar solo uno de los dos, pero la función no debe confiar en eso: una fila
    // vieja o un import podrían traerla incompleta, y mostrar un mensaje que nunca vence sería
    // exactamente el problema que esta feature vino a resolver.
    expect(resolverMensajeCercania(BASE, CAMPANA, null, HOY)).toBe(BASE);
    expect(resolverMensajeCercania(BASE, null, '2026-07-30', HOY)).toBe(BASE);
  });

  it('sin base ni campaña vigente no hay mensaje', () => {
    // null y no cadena vacía: quien construye el pase omite relevantText por completo en vez de
    // grabar un texto en blanco.
    expect(resolverMensajeCercania(null, null, null, HOY)).toBeNull();
    expect(resolverMensajeCercania(null, CAMPANA, '2026-07-27', HOY)).toBeNull();
  });

  it('una campaña vigente sirve aunque no haya mensaje base', () => {
    expect(resolverMensajeCercania(null, CAMPANA, '2026-07-30', HOY)).toBe(CAMPANA);
  });

  it('tolera una fecha con hora pegada', () => {
    // Por si alguna vez la columna llega como timestamp desde otro camino.
    expect(resolverMensajeCercania(BASE, CAMPANA, '2026-07-30T00:00:00Z', HOY)).toBe(CAMPANA);
  });
});
