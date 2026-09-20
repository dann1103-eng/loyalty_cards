import { describe, it, expect } from 'vitest';
import { TEMAS, TEMA_POR_DEFECTO } from '../tema';
import { bloque, mapaDeTema, normalizarSelector, regla, reglas, resolver } from './tokensCss';

// MUTATION-TESTING: este parser es lo único que hay entre app/globals.css y las pruebas de diseño;
// si lee mal, las pruebas miden otra cosa. Mutaciones que deben fallar:
// (1) no quitar comentarios → el `}` del comentario de la fixture cierra una llave nunca abierta;
// (2) partir por coma o punto y coma ADENTRO de paréntesis → se rompen `.b:is(x, y)` y el rgba de
//     `--sombra`;
// (3) contar como de primer nivel una regla de adentro de un @media → `.a` tomaría el `red`;
// (4) que la segunda regla `.a` no pise a la primera → background no sería transparent;
// (5) sacar el chequeo de indentación → el token con cuatro espacios pasa en silencio;
// (6) que resolver no detecte ciclos → se cuelga (lo corta el timeout) en vez de lanzar.

// El tema que NO es el default: la fixture no puede fijar cuál es, porque el default cambia (era
// oscuro, pasa a claro) y esta prueba tiene que seguir midiendo lo mismo.
const OTRO = TEMAS.filter((t) => t !== TEMA_POR_DEFECTO)[0];

const CSS = `
/* Un comentario con } y con :root { adentro no puede cortar ni confundir el bloque. */
:root {
  --fondo: #131313;
  --blanco: #f5f5f0;
  --texto: var(--blanco); /* comentario al final de la línea */
  --sombra:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    0 2px 4px var(--fondo);
}

:root[data-tema="${OTRO}"] {
  color-scheme: light;
  --fondo: #f4f1ec;
}

.a,
.b:is(x, y) {
  color: var(--texto);
  background: var(--fondo);
}

@media (min-width: 760px) {
  .a {
    color: red;
  }
}

.a {
  background: transparent;
}
`;

describe('bloque', () => {
  it('lee los tokens sin cortarse por un } ni confundirse por un :root { de un comentario', () => {
    const raiz = bloque(CSS, ':root');
    expect([...raiz.keys()]).toEqual(['--fondo', '--blanco', '--texto', '--sombra']);
    expect(raiz.get('--texto')).toBe('var(--blanco)');
    // Un valor de varias líneas queda en una sola, con los espacios normalizados.
    expect(raiz.get('--sombra')).toBe('0 0 0 1px rgba(0, 0, 0, 0.5), 0 2px 4px var(--fondo)');
  });

  it('devuelve solo tokens: color-scheme no es un token', () => {
    expect([...bloque(CSS, `:root[data-tema="${OTRO}"]`).keys()]).toEqual(['--fondo']);
  });

  it('lanza si un token no tiene exactamente dos espacios de indentación', () => {
    const css = ':root {\n  --a: #000;\n    --b: #fff;\n}';
    expect(() => bloque(css, ':root')).toThrow('indentación distinta de dos espacios en --b');
  });

  it('lanza si el bloque no existe o aparece dos veces', () => {
    expect(() => bloque(CSS, ':root[data-tema="sepia"]')).toThrow(
      'el bloque :root[data-tema="sepia"] aparece 0 veces',
    );
    expect(() => bloque(`${CSS}\n:root {\n  --x: #000;\n}`, ':root')).toThrow('el bloque :root aparece 2 veces');
  });
});

describe('mapaDeTema', () => {
  it('el default es :root; otro tema es :root más su bloque, como la cascada en <html>', () => {
    expect(mapaDeTema(CSS, TEMA_POR_DEFECTO).get('--fondo')).toBe('#131313');
    const otro = mapaDeTema(CSS, OTRO);
    expect(otro.get('--fondo')).toBe('#f4f1ec'); // lo pisa su bloque
    expect(otro.get('--texto')).toBe('var(--blanco)'); // lo hereda de :root
  });
});

describe('resolver', () => {
  const mapa = new Map([
    ['--blanco', '#f5f5f0'],
    ['--texto', 'var(--blanco)'],
    ['--alias', 'var(--texto)'],
    ['--a', 'var(--b)'],
    ['--b', 'var(--a)'],
    ['--con-respaldo', 'var(--blanco, #fff)'],
    ['--roto', 'var(--no-existe)'],
    ['--lista', '0 0 0 1px var(--blanco)'],
  ]);

  it('sigue cadenas de var() hasta un valor', () => {
    expect(resolver('--alias', mapa)).toBe('#f5f5f0');
  });

  it('devuelve tal cual un valor que no es un var() solo', () => {
    expect(resolver('--lista', mapa)).toBe('0 0 0 1px var(--blanco)');
  });

  it('lanza ante un ciclo, un token que no existe o un valor de respaldo', () => {
    expect(() => resolver('--a', mapa)).toThrow('referencia circular: --a → --b → --a');
    expect(() => resolver('--roto', mapa)).toThrow('el token --no-existe no está definido');
    expect(() => resolver('--con-respaldo', mapa)).toThrow(
      'var() con valor de respaldo no soportado: --con-respaldo',
    );
  });
});

describe('regla', () => {
  it('fusiona las reglas de primer nivel en orden (la última gana) e ignora las de un @media', () => {
    const a = regla(CSS, '.a');
    expect(a.get('color')).toBe('var(--texto)'); // el `red` de adentro del @media no cuenta
    expect(a.get('background')).toBe('transparent'); // la segunda regla .a pisa a la primera
  });

  it('encuentra un selector con una coma adentro de :is(), sin importar los espacios', () => {
    expect(regla(CSS, '.b:is(x,y)').get('background')).toBe('var(--fondo)');
  });

  it('lanza si la regla no existe', () => {
    expect(() => regla(CSS, '.c')).toThrow('no existe la regla .c');
  });
});

describe('reglas', () => {
  it('marca las reglas que viven adentro de un @media', () => {
    const deA = reglas(CSS).filter((r) => r.selectores.includes('.a'));
    expect(deA.map((r) => r.dentroDeArroba)).toEqual([false, true, false]);
  });
});

describe('normalizarSelector', () => {
  it('colapsa espacios y los quita alrededor de comas y combinadores', () => {
    expect(normalizarSelector('.field  :is(input , select)')).toBe('.field :is(input,select)');
    expect(normalizarSelector('.a  >  .b')).toBe('.a>.b');
  });
});
