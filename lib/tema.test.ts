import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { CLAVE_TEMA, SCRIPT_TEMA, TEMAS, TEMA_POR_DEFECTO, esTema, normalizarTema, type Tema } from './tema';
import { bloque, regla } from './diseno/tokensCss';

// MUTATION-TESTING: lo que estas pruebas protegen es el CONTRATO ENTRE DOS MUNDOS — el script que
// corre en el <head> (texto plano, sin tipos) y el selector de React. Mutaciones que deben fallar:
// (1) cambiar CLAVE_TEMA en un lado y no en el otro → el script leería una clave que nadie escribe
//     y el tema volvería al default en cada recarga (destello permanente, no un bug visible en dev);
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

  it('normalizarTema degrada al default cualquier valor que no sea un tema', () => {
    expect(normalizarTema('claro')).toBe('claro');
    expect(normalizarTema('alto-contraste')).toBe('alto-contraste');
    expect(normalizarTema('lo-que-sea')).toBe(TEMA_POR_DEFECTO);
    expect(normalizarTema(undefined)).toBe(TEMA_POR_DEFECTO);
    expect(TEMA_POR_DEFECTO).toBe('claro'); // el default desde el rediseño neumórfico (2026-09-20)
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
    expect(correr('inventado')).toBeUndefined(); // sin atributo → :root, que es el default (claro)
    expect(correr(null)).toBeUndefined();
  });
});

// El otro contrato entre dos mundos: TEMAS (TypeScript) contra los bloques de globals.css. Nada ata
// el uno al otro. Los `Record<Tema, …>` (ETIQUETAS_TEMA acá abajo, ESQUEMA más adelante) te obligan
// a llenar las tablas de TypeScript al agregar un tema, pero NADIE te obliga a escribir su bloque de
// CSS: con las tablas llenas, 'sepia' compila, pasa el lint y sale como un botón más en el selector
// que no hace absolutamente nada. Y agregar una variable a :root sin darle valor en los otros temas
// deja esa pantalla con el color del tema por defecto incrustado.
// Las dos cosas se descubrirían mirando el panel en tres temas, que es justo lo que nadie rehace.
describe('temas contra app/globals.css', () => {
  const css = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');

  // Los tokens de un bloque, leídos con el parser único (lib/diseno/tokensCss.ts): quita los
  // comentarios, así que un `}` adentro de uno ya no corta el bloque, y lanza ante un token con
  // otra indentación en vez de no verlo.
  const tokensDe = (selector: string): Set<string> => new Set(bloque(css, selector).keys());

  // Tokens que a propósito NO cambian con el tema. Si agregás uno acá, que sea porque es una
  // constante (marca, forma, espaciado) — no para silenciar la prueba de abajo.
  const CONSTANTES = new Set([
    '--blanco', // constante de marca: el hueso de la tarjeta de billetera
    '--radius',
    '--radius-field',
    '--radius-control',
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
      // El mensaje NO afirma la causa: bloque() lanza por tres motivos (no existe, está repetido, o
      // tiene un token mal indentado), y el suyo es más preciso que cualquier cosa que digamos acá.
      expect(() => bloque(css, `:root[data-tema="${t}"]`), `no se pudo leer el bloque del tema "${t}"`).not.toThrow();
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

  // La fuente de verdad del esquema de cada tema es ESTE mapa, no el CSS: comparar el CSS contra sí
  // mismo seguiría verde con html en dark y el default en claro.
  const ESQUEMA: Record<Tema, 'light' | 'dark'> = { oscuro: 'dark', claro: 'light', 'alto-contraste': 'dark' };

  it('color-scheme: cada bloque el de su tema, y html el del default', () => {
    // Sin esto el navegador pinta los <select>, los scrollbars y el autofill con el esquema del
    // tema anterior: campos oscuros dentro de un panel claro.
    for (const t of TEMAS) {
      if (t === TEMA_POR_DEFECTO) continue;
      const esquema = regla(css, `:root[data-tema="${t}"]`).get('color-scheme');
      expect(esquema, `el tema "${t}" declara color-scheme ${esquema} y debería ser ${ESQUEMA[t]}`).toBe(
        ESQUEMA[t],
      );
    }
    const html = regla(css, 'html').get('color-scheme');
    expect(
      html,
      `html declara color-scheme ${html} y el default (${TEMA_POR_DEFECTO}) es ${ESQUEMA[TEMA_POR_DEFECTO]}`,
    ).toBe(ESQUEMA[TEMA_POR_DEFECTO]);
    // El del default vive en `html` (0,0,1) y NO en `:root` (0,1,0), que le ganaría por
    // especificidad: si alguien lo agregara ahí, el navegador usaría ese y la aserción de arriba
    // seguiría verde mirando una declaración que ya no manda.
    expect(
      regla(css, ':root').get('color-scheme'),
      ':root declara color-scheme y le gana a html por especificidad: el default se declara en html',
    ).toBeUndefined();
  });
});
