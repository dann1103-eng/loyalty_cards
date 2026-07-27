import { describe, it, expect } from 'vitest';
import { CLAVE_TEMA, SCRIPT_TEMA, TEMAS, TEMA_POR_DEFECTO, esTema, normalizarTema } from './tema';

// MUTATION-TESTING: lo que estas pruebas protegen es el CONTRATO ENTRE DOS MUNDOS — el script que
// corre en el <head> (texto plano, sin tipos) y el selector de React. Mutaciones que deben fallar:
// (1) cambiar CLAVE_TEMA en un lado y no en el otro → el script leería una clave que nadie escribe
//     y el tema volvería a oscuro en cada recarga (destello permanente, no un bug visible en dev);
// (2) que normalizarTema devuelva el valor crudo → un data-tema basura del inspector se propagaría
//     a localStorage y dejaría el panel sin ningún bloque de tema aplicado;
// (3) que el script acepte cualquier string → mismo agujero, pero desde el HTML.
describe('tema', () => {
  it('esTema acepta los tres temas y rechaza cualquier otra cosa', () => {
    expect(TEMAS).toEqual(['oscuro', 'claro', 'alto-contraste']);
    for (const t of TEMAS) expect(esTema(t)).toBe(true);
    expect(esTema('Oscuro')).toBe(false); // sensible a mayúsculas: el CSS también lo es
    expect(esTema('alto contraste')).toBe(false); // sin guion no matchea [data-tema=…]
    expect(esTema(null)).toBe(false);
    expect(esTema(undefined)).toBe(false);
    expect(esTema(0)).toBe(false);
  });

  it('normalizarTema degrada a oscuro cualquier valor que no sea un tema', () => {
    expect(normalizarTema('claro')).toBe('claro');
    expect(normalizarTema('alto-contraste')).toBe('alto-contraste');
    expect(normalizarTema('lo-que-sea')).toBe(TEMA_POR_DEFECTO);
    expect(normalizarTema(undefined)).toBe(TEMA_POR_DEFECTO);
    expect(TEMA_POR_DEFECTO).toBe('oscuro'); // el default NO cambia: es el tema que ya tenían
  });

  it('el script del <head> lee LA MISMA clave y valida contra LOS MISMOS temas', () => {
    // Literales, no interpolaciones: comparar SCRIPT_TEMA contra las constantes de las que se
    // construye sería una tautología que sigue verde con la clave renombrada a medias.
    expect(CLAVE_TEMA).toBe('cardly-tema');
    expect(SCRIPT_TEMA).toContain('localStorage.getItem("cardly-tema")');
    expect(SCRIPT_TEMA).toContain('["oscuro","claro","alto-contraste"].indexOf(t)>-1');
    expect(SCRIPT_TEMA).toContain('document.documentElement.dataset.tema=t');
    // try/catch: en Safari privado localStorage tira, y una excepción en el <head> aborta el
    // script — pero el HTML ya está pintándose, así que el usuario vería el panel sin tema.
    expect(SCRIPT_TEMA).toContain('try{');
    expect(SCRIPT_TEMA).toContain('catch(e){}');
  });

  it('el script es evaluable y aplica el tema guardado antes de cualquier render', () => {
    // Se ejecuta de verdad contra dobles de localStorage/document: un error de sintaxis en un
    // string que nadie compila (el <head> no pasa por TypeScript) es exactamente el bug que este
    // archivo existe para atrapar.
    const correr = (guardado: string | null) => {
      const html = { dataset: {} as Record<string, string> };
      new Function(
        'localStorage',
        'document',
        SCRIPT_TEMA,
      )({ getItem: () => guardado }, { documentElement: html });
      return html.dataset.tema;
    };
    expect(correr('claro')).toBe('claro');
    expect(correr('alto-contraste')).toBe('alto-contraste');
    expect(correr('inventado')).toBeUndefined(); // sin atributo → :root, que es el tema oscuro
    expect(correr(null)).toBeUndefined();
  });
});
