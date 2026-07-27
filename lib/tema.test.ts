import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// El otro contrato entre dos mundos: TEMAS (TypeScript) contra los bloques de globals.css. Nada en
// el compilador los ata. Agregar 'sepia' a TEMAS y olvidar el CSS compila, pasa el lint y se ve como
// un botón más en el selector que no hace absolutamente nada; y agregar una variable a :root sin
// darle valor en los otros dos temas deja esa pantalla con el color del tema oscuro incrustado.
// Las dos cosas se descubrirían mirando el panel en tres temas, que es justo lo que nadie rehace.
describe('temas contra app/globals.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

  // Declaraciones de un bloque, hasta su primer '}' (los bloques de tema no anidan nada).
  const tokensDe = (selector: string): Set<string> => {
    const desde = css.indexOf(`${selector} {`);
    expect(desde, `no existe el bloque ${selector} en globals.css`).toBeGreaterThan(-1);
    const hasta = css.indexOf('}', desde);
    return new Set(
      [...css.slice(desde, hasta).matchAll(/^\s{2}(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
  };

  // Tokens que a propósito NO cambian con el tema. Si agregás uno acá, que sea porque es una
  // constante (marca, forma, espaciado) — no para silenciar la prueba de abajo.
  const CONSTANTES = new Set([
    '--blanco', // constante de marca: el hueso de la tarjeta de billetera
    '--radius',
    '--radius-field',
    '--radius-pill',
    '--sp-1',
    '--sp-2',
    '--sp-3',
    '--sp-4',
    '--sp-5',
    '--sp-6',
    '--sp-7',
    '--shadow-card', // alias: es var(--shadow-2), que sí se redefine por tema
  ]);

  it('cada tema que no es el default tiene su bloque :root[data-tema=…]', () => {
    for (const t of TEMAS) {
      if (t === TEMA_POR_DEFECTO) continue; // el default ES :root, no lleva bloque propio
      expect(css, `falta el bloque de CSS del tema "${t}"`).toContain(`:root[data-tema="${t}"] {`);
    }
  });

  it('cada tema redefine TODOS los tokens variables de :root', () => {
    const raiz = tokensDe(':root');
    // Referencia dura: si :root adelgaza porque alguien borró tokens, esto avisa en vez de dar por
    // buenos dos temas que ya no cubren nada.
    expect(raiz.size).toBeGreaterThan(40);
    const variables = [...raiz].filter((v) => !CONSTANTES.has(v));

    for (const t of TEMAS) {
      if (t === TEMA_POR_DEFECTO) continue;
      const delTema = tokensDe(`:root[data-tema="${t}"]`);
      const faltantes = variables.filter((v) => !delTema.has(v));
      expect(faltantes, `el tema "${t}" no redefine estos tokens`).toEqual([]);
      // Y al revés: un token que solo existe en un tema no lo hereda nadie.
      const huerfanos = [...delTema].filter((v) => !raiz.has(v));
      expect(huerfanos, `el tema "${t}" declara tokens que :root no define`).toEqual([]);
    }
  });

  it('color-scheme se declara en cada tema (form controls y scrollbars nativos)', () => {
    // Sin esto el navegador pinta los <select>, los scrollbars y el autofill con el esquema del
    // tema anterior: campos oscuros dentro de un panel claro.
    for (const t of TEMAS) {
      if (t === TEMA_POR_DEFECTO) continue;
      const bloque = css.slice(
        css.indexOf(`:root[data-tema="${t}"] {`),
        css.indexOf('}', css.indexOf(`:root[data-tema="${t}"] {`)),
      );
      expect(bloque, `el tema "${t}" no declara color-scheme`).toMatch(/color-scheme:\s*(light|dark)/);
    }
  });
});
