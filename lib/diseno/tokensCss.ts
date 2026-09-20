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

export function sinComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
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

function leerDeclaraciones(cuerpo: string): Map<string, string> {
  const declaraciones = new Map<string, string>();
  for (const cruda of partirFueraDeParentesis(cuerpo, ';')) {
    const declaracion = cruda.trim();
    if (!declaracion) continue;
    const dosPuntos = declaracion.indexOf(':');
    if (dosPuntos < 0) throw new Error(`declaración ilegible: ${declaracion}`);
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
      if (!abierto) throw new Error(`llave de cierre sin abrir en la posición ${i}`);
      if (!abierto.arroba) {
        const cuerpo = limpio.slice(abierto.cuerpoDesde, i);
        resultado.push({
          selectores: partirFueraDeParentesis(abierto.prelude, ',').map(normalizarSelector),
          declaraciones: leerDeclaraciones(cuerpo),
          cuerpo,
          dentroDeArroba: abiertos.some((a) => a.arroba),
        });
      }
      desde = i + 1;
    }
  }
  if (abiertos.length > 0) throw new Error('quedó una llave sin cerrar');
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
    throw new Error(`el bloque ${selector} aparece ${candidatos.length} veces en el CSS (se esperaba 1)`);
  }
  const [unico] = candidatos;
  for (const linea of unico.cuerpo.split(/\r?\n/)) {
    const token = /^(\s*)(--[a-z0-9-]+)\s*:/.exec(linea);
    if (token && token[1] !== '  ') throw new Error(`indentación distinta de dos espacios en ${token[2]}`);
  }
  return new Map([...unico.declaraciones].filter(([nombre]) => nombre.startsWith('--')));
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
    const referencia = /^var\((--[a-z0-9-]+)(\s*,[\s\S]*)?\)$/.exec(valor);
    if (!referencia) return valor;
    if (referencia[2] !== undefined) {
      throw new Error(`var() con valor de respaldo no soportado: ${actual}: ${valor}`);
    }
    actual = referencia[1];
  }
}
