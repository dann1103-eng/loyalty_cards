import { TEMA_POR_DEFECTO, type Tema } from '../tema';

// Lectura de app/globals.css para las pruebas de diseño. Es el ÚNICO parser del CSS en el repo: lo
// usan lib/tema.test.ts y lib/diseno/temas.test.ts. Si cada prueba tuviera el suyo, podrían leer el
// mismo archivo de dos maneras distintas sin que ninguna se enterara.
//
// No es un parser de CSS general. Entiende lo que hay en globals.css — reglas planas, y @media /
// @keyframes que las envuelven, sin anidamiento — y LANZA ante lo que no sabe leer.

export type Regla = {
  selectores: string[]; // ya normalizados
  declaraciones: Map<string, string>;
  cuerpo: string; // el texto crudo entre las llaves, sin comentarios
  dentroDeArroba: boolean; // vive dentro de un @media, @keyframes, @supports…
};

// Reemplaza cada comentario por espacios en vez de borrarlo: así las posiciones del texto limpio
// siguen coincidiendo con las del archivo en disco y un error puede decir en qué línea está. Con
// ~100 líneas de comentario en globals.css, un offset sobre el texto recortado no sirve para nada.
export function sinComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comentario) => comentario.replace(/[^\n]/g, ' '));
}

function ubicacion(texto: string, posicion: number): string {
  const antes = texto.slice(0, posicion);
  return `línea ${antes.split('\n').length}, columna ${posicion - antes.lastIndexOf('\n')}`;
}

// Parte en `separador` solo FUERA de paréntesis: `:is(a, b)` es un selector, no dos, y
// `rgba(0, 0, 0, 0.5)` es un valor, no cuatro.
function partirFueraDeParentesis(texto: string, separador: ',' | ';'): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let desde = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '(') profundidad++;
    else if (c === ')') profundidad--;
    else if (c === separador && profundidad === 0) {
      partes.push(texto.slice(desde, i));
      desde = i + 1;
    }
  }
  // Un paréntesis sin cerrar deja la profundidad arriba de cero y se traga todo lo que sigue: sin
  // esta guarda, `rgb(0, 0, 0; background: red` devuelve UNA declaración ilegible y el background
  // desaparece en silencio.
  if (profundidad !== 0) throw new Error(`paréntesis sin balancear en: ${texto.trim().slice(0, 70)}`);
  partes.push(texto.slice(desde));
  return partes;
}

// Colapsa espacios y los quita alrededor de comas y combinadores, para que `.a > .b` y `.a>.b`, o
// `:is(a, b)` y `:is(a,b)`, sean el mismo selector.
export function normalizarSelector(selector: string): string {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([,>+~])\s*/g, '$1')
    .trim();
}

function leerDeclaraciones(cuerpo: string, selector: string): Map<string, string> {
  const declaraciones = new Map<string, string>();
  for (const cruda of partirFueraDeParentesis(cuerpo, ';')) {
    const declaracion = cruda.trim();
    if (!declaracion) continue;
    const dosPuntos = declaracion.indexOf(':');
    if (dosPuntos < 0) throw new Error(`declaración ilegible en "${selector}": ${declaracion}`);
    const nombre = declaracion.slice(0, dosPuntos).trim();
    const propiedad = nombre.startsWith('--') ? nombre : nombre.toLowerCase();
    declaraciones.set(propiedad, declaracion.slice(dosPuntos + 1).replace(/\s+/g, ' ').trim());
  }
  return declaraciones;
}

// Todas las reglas de estilo del archivo, en orden, a cualquier profundidad.
export function reglas(css: string): Regla[] {
  const limpio = sinComentarios(css);
  const resultado: Regla[] = [];
  const abiertos: Array<{ arroba: boolean; prelude: string; cuerpoDesde: number }> = [];
  let desde = 0;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === '{') {
      const prelude = limpio.slice(desde, i).trim();
      abiertos.push({ arroba: prelude.startsWith('@'), prelude, cuerpoDesde: i + 1 });
      desde = i + 1;
    } else if (c === '}') {
      const abierto = abiertos.pop();
      if (!abierto) throw new Error(`llave de cierre sin abrir en ${ubicacion(limpio, i)}`);
      if (!abierto.arroba) {
        const cuerpo = limpio.slice(abierto.cuerpoDesde, i);
        // El anidamiento nativo de CSS (`.a { &:hover { … } }`) no se soporta, y sin esta guarda no
        // se rompe: se lee MAL en silencio, inventando una regla con un selector basura y perdiendo
        // declaraciones. El contrato de este módulo es lanzar ante lo que no sabe leer.
        if (cuerpo.includes('{')) {
          throw new Error(
            `anidamiento no soportado en "${abierto.prelude}" (${ubicacion(limpio, abierto.cuerpoDesde)})`,
          );
        }
        resultado.push({
          selectores: partirFueraDeParentesis(abierto.prelude, ',').map(normalizarSelector),
          declaraciones: leerDeclaraciones(cuerpo, abierto.prelude),
          cuerpo,
          dentroDeArroba: abiertos.some((a) => a.arroba),
        });
      }
      desde = i + 1;
    }
  }
  const sinCerrar = abiertos[abiertos.length - 1];
  if (sinCerrar) {
    throw new Error(`quedó sin cerrar "${sinCerrar.prelude}" (${ubicacion(limpio, sinCerrar.cuerpoDesde)})`);
  }
  return resultado;
}

// Las declaraciones de la regla de primer nivel (fuera de @media / @keyframes) cuya lista de
// selectores contiene EXACTAMENTE `selector`. Si hay varias, se fusionan en orden y la última gana,
// igual que en la cascada entre reglas de la misma especificidad.
export function regla(css: string, selector: string): Map<string, string> {
  const buscado = normalizarSelector(selector);
  const encontradas = reglas(css).filter((r) => !r.dentroDeArroba && r.selectores.includes(buscado));
  if (encontradas.length === 0) throw new Error(`no existe la regla ${selector}`);
  return new Map(encontradas.flatMap((r) => [...r.declaraciones]));
}

// Los tokens (--x) de un bloque de tema. El bloque tiene que existir UNA vez, con ese selector solo.
//
// Exige dos espacios de indentación: es la forma que documenta DESIGN.md, y la que permite
// encontrar todos los tokens con un grep de `^  --`. Con el parser viejo, un token con otra
// indentación era invisible para la prueba sin que nadie se enterara; con este, lanza.
export function bloque(css: string, selector: string): Map<string, string> {
  const buscado = normalizarSelector(selector);
  const candidatos = reglas(css).filter(
    (r) => !r.dentroDeArroba && r.selectores.length === 1 && r.selectores[0] === buscado,
  );
  if (candidatos.length !== 1) {
    const enGrupo = reglas(css).some((r) => !r.dentroDeArroba && r.selectores.includes(buscado));
    const detalle = enGrupo && candidatos.length === 0 ? ', pero existe compartiendo regla con otros selectores' : '';
    throw new Error(
      `el bloque ${selector} aparece ${candidatos.length} veces en el CSS (se esperaba 1)${detalle}`,
    );
  }
  const [unico] = candidatos;
  const enSuPropiaLinea = new Set<string>();
  for (const linea of unico.cuerpo.split(/\r?\n/)) {
    const token = /^(\s*)(--[\w-]+)\s*:/.exec(linea);
    if (!token) continue;
    if (token[1] !== '  ') throw new Error(`indentación distinta de dos espacios en ${token[2]}`);
    enSuPropiaLinea.add(token[2]);
  }
  const tokens = new Map([...unico.declaraciones].filter(([nombre]) => nombre.startsWith('--')));
  // El lint de arriba solo mira el token que ABRE cada línea. Sin este cruce contra lo que de verdad
  // se devuelve, `--a: #000; --b: #fff;` en una sola línea pasa, y `--b` queda invisible para el
  // grep de `^  --` que documenta DESIGN.md: justo lo que el lint existe para impedir.
  for (const nombre of tokens.keys()) {
    if (!enSuPropiaLinea.has(nombre)) {
      throw new Error(`${nombre} no abre su propia línea: un grep de "^  --" no lo encontraría`);
    }
  }
  return tokens;
}

// Los tokens tal como los ve el <html> con ese tema aplicado: el default es :root; cualquier otro
// es :root más su bloque, que pisa lo que redefine (la misma cascada que en el navegador).
export function mapaDeTema(css: string, tema: Tema): Map<string, string> {
  const raiz = bloque(css, ':root');
  if (tema === TEMA_POR_DEFECTO) return raiz;
  return new Map([...raiz, ...bloque(css, `:root[data-tema="${tema}"]`)]);
}

// Sigue una cadena de var(--x) hasta un valor que no es un var() solo (p. ej. --texto → --blanco →
// #f5f5f0). Un valor compuesto (`4px 4px 10px var(--x), …`) se devuelve tal cual.
export function resolver(nombre: string, mapa: Map<string, string>): string {
  const camino: string[] = [];
  let actual = nombre;
  for (;;) {
    if (camino.includes(actual)) throw new Error(`referencia circular: ${[...camino, actual].join(' → ')}`);
    camino.push(actual);
    const valor = mapa.get(actual);
    if (valor === undefined) throw new Error(`el token ${actual} no está definido`);
    // `[\w-]+` y no `[a-z0-9-]+`: el charset legal de una custom property incluye mayúsculas y guion
    // bajo, y con la regex estrecha un `var(--Fondo)` o un `var( --b )` no encajaba, se devolvía
    // CRUDO y el error terminaba saliendo desde el parseo de color, apuntando al lugar equivocado.
    const referencia = /^var\(\s*(--[\w-]+)\s*(,[\s\S]*)?\)$/.exec(valor);
    if (!referencia) return valor;
    if (referencia[2] !== undefined) {
      throw new Error(`var() con valor de respaldo no soportado: ${actual}: ${valor}`);
    }
    actual = referencia[1];
  }
}
