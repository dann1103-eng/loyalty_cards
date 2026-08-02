import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { ARCHIVO_POR_PESO, dibujarTextoConInter, rutaDeFuente } from './textoInter';
import { PESOS_TEXTO, type OpcionesTexto } from './texto';

const BASE: OpcionesTexto = {
  texto: 'Café Sol',
  x: 200,
  y: 100,
  tamano: 40,
  peso: 700,
  anclaje: 'centro',
  color: '#f5ede0',
};

// El `d` que emite opentype.js usa SOLO comandos absolutos con las coordenadas de a pares
// (M x y / L x y / Q x1 y1 x y / Z), así que todo número en índice par es una x y todo impar una y.
// Verificado el 2026-08-02 sobre la salida real: los únicos comandos presentes son M, L, Q y Z.
function coordenadas(g: string): { xs: number[]; ys: number[] } {
  const d = g.match(/ d="([^"]*)"/)?.[1] ?? '';
  const numeros = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return {
    xs: numeros.filter((_, i) => i % 2 === 0),
    ys: numeros.filter((_, i) => i % 2 === 1),
  };
}

function cajaX(g: string): { min: number; max: number; centro: number } {
  const { xs } = coordenadas(g);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { min, max, centro: (min + max) / 2 };
}

describe('dibujarTextoConInter', () => {
  it('emite contornos y NI UN <text> (que es lo que se imprime en cuadraditos)', () => {
    const g = dibujarTextoConInter(BASE);
    expect(g).toContain('<path d="');
    expect(g).not.toContain('<text');
  });

  // Los contornos no son texto para nadie que lea el SVG: sin el aria-label, el nombre del negocio
  // deja de existir para un lector de pantalla y para cualquier búsqueda dentro del archivo.
  it('conserva el texto legible en aria-label, escapado como XML', () => {
    const g = dibujarTextoConInter({ ...BASE, texto: 'Café & Té' });
    expect(g).toContain('aria-label="Café &amp; Té"');
    expect(g).not.toContain('aria-label="Café & Té"');
  });

  it('un texto vacío no dibuja nada', () => {
    expect(dibujarTextoConInter({ ...BASE, texto: '' })).toBe('');
  });

  // `text-anchor="middle"` no existe para un <path>: el centrado se calcula a mano con el ancho de
  // avance. Si esa cuenta se pierde, el nombre del negocio y el CTA se van todos hacia la derecha y
  // el cartel sale descuadrado — pero el PNG se genera igual, así que solo se vería IMPRIMIÉNDOLO.
  it('con anclaje "centro" el texto queda centrado en x', () => {
    for (const texto of ['Café Sol', '¡Escaneá y sumate!', 'C']) {
      const { centro } = cajaX(dibujarTextoConInter({ ...BASE, texto }));
      // Medido el 2026-08-02: el desvío máximo de los tres es 0,32 sobre un cuerpo de 40 (0,8%).
      // El resto es el bearing lateral del primer y último glifo, que no es simétrico.
      expect(Math.abs(centro - BASE.x), `"${texto}" quedó centrado en ${centro} y no en ${BASE.x}`)
        .toBeLessThan(BASE.tamano * 0.02);
    }
  });

  // El control que le da valor a la prueba de arriba: con el otro anclaje el texto NO está centrado,
  // arranca en x. Sin esto, un dibujante que ignorara `anclaje` pasaría la mitad de las veces.
  it('con anclaje "inicio" el texto ARRANCA en x en vez de centrarse', () => {
    const { min, centro } = cajaX(dibujarTextoConInter({ ...BASE, anclaje: 'inicio' }));
    expect(min).toBeGreaterThanOrEqual(BASE.x);
    expect(min).toBeLessThan(BASE.x + BASE.tamano * 0.1);
    // Medido: el centro cae en 281,5 con x=200 — a dos cuerpos de distancia. Si el anclaje se
    // ignorara y todo saliera centrado, esta aserción lo delata.
    expect(centro).toBeGreaterThan(BASE.x + BASE.tamano);
  });

  // `y` es la LÍNEA BASE, igual que en un <text>. Toda la geometría de plantillas.ts está escrita
  // contra esa convención: si acá se interpretara como el borde superior, cada texto del cartel
  // subiría una altura de línea y el teaser se saldría del papel.
  it('y es la línea base: un texto sin colas apoya JUSTO en y', () => {
    // "Sol" no tiene ni una letra con cola: las tres apoyan en la línea base, así que el borde de
    // abajo de la caja tiene que caer en y (medido: 100,4 con y=100 — esos 0,4 son el rebase de la
    // curva de la 'o' y la 'S', que las tipografías dibujan un pelo por debajo a propósito).
    const { ys } = coordenadas(dibujarTextoConInter({ ...BASE, texto: 'Sol' }));
    const abajo = Math.max(...ys);
    const arriba = Math.min(...ys);
    expect(Math.abs(abajo - BASE.y), `el texto apoya en ${abajo} y la línea base es ${BASE.y}`)
      .toBeLessThan(BASE.tamano * 0.05);
    // Y crece hacia ARRIBA desde ahí (en SVG, menos y es más arriba): si se interpretara y como el
    // borde superior, la caja entera estaría por debajo.
    expect(arriba).toBeLessThan(BASE.y - BASE.tamano * 0.5);
  });

  it('y es la línea base: moverla desplaza todas las coordenadas exactamente igual', () => {
    const arriba = coordenadas(dibujarTextoConInter(BASE));
    const abajo = coordenadas(dibujarTextoConInter({ ...BASE, y: BASE.y + 50 }));

    expect(abajo.xs).toEqual(arriba.xs);
    expect(abajo.ys).toEqual(arriba.ys.map((v) => Number((v + 50).toFixed(2))));
  });

  // Cada peso tiene que salir de SU archivo. Si los tres apuntaran al mismo .ttf, el cartel perdería
  // toda su jerarquía tipográfica (nombre, CTA y teaser con el mismo grosor) y ninguna prueba de
  // píxeles lo notaría: la tinta total apenas cambia.
  it('los tres pesos dibujan contornos distintos', () => {
    const porPeso = PESOS_TEXTO.map((peso) => dibujarTextoConInter({ ...BASE, peso }));
    expect(new Set(porPeso).size).toBe(PESOS_TEXTO.length);
  });
});

// Estas dos no miran píxeles: vigilan que el archivo de fuente siga estando donde el código lo
// abre, y que Next lo siga copiando al bundle serverless. Es el único eslabón del arreglo que
// depende de algo fuera del código, así que es el único que puede romperse en un deploy sin que se
// note en la máquina de desarrollo.
describe('las fuentes del cartel viajan con el deploy', () => {
  it('los tres .ttf están donde textoInter.ts los busca, con su licencia al lado', () => {
    for (const peso of PESOS_TEXTO) {
      const ruta = rutaDeFuente(ARCHIVO_POR_PESO[peso]);
      expect(existsSync(ruta), `falta la fuente del peso ${peso} en ${ruta}`).toBe(true);
    }
    // Inter es SIL Open Font License 1.1, y la OFL exige distribuir el texto de la licencia junto a
    // la fuente. Si el archivo desaparece, el repo queda incumpliendo la licencia.
    const licencia = rutaDeFuente('LICENSE-Inter-OFL.txt');
    expect(existsSync(licencia), `falta ${licencia}`).toBe(true);
    expect(readFileSync(licencia, 'utf8')).toContain('SIL Open Font License');
  });

  it('la ruta que traza next.config.ts es la misma que abre textoInter.ts', () => {
    const carpeta = relative(process.cwd(), dirname(rutaDeFuente(ARCHIVO_POR_PESO[700]))).replace(/\\/g, '/');
    const config = readFileSync('next.config.ts', 'utf8');
    // Sin esta entrada, el tracing de Next no se entera de la carpeta (la ruta se arma en tiempo de
    // ejecución, no hay un import que seguir) y la descarga del cartel responde 500 en producción.
    expect(
      config,
      `next.config.ts no incluye "${carpeta}" en outputFileTracingIncludes: las fuentes no llegarían al lambda`,
    ).toContain(`${carpeta}/**/*`);
  });
});

// El arreglo cambió un fallo MUDO (cartel impreso en cuadraditos) por uno ruidoso. Esto verifica que
// el ruidoso de verdad hace ruido, y que el mensaje dice qué revisar.
describe('si la fuente no llegó al deploy', () => {
  it('revienta con un mensaje que explica el problema, en vez de dibujar cualquier cosa', async () => {
    vi.resetModules();
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/carpeta/que/no/existe');
    try {
      const { dibujarTextoConInter: sinFuente } = await import('./textoInter');
      expect(() => sinFuente(BASE)).toThrow(/No se encontró la fuente del cartel/);
      expect(() => sinFuente(BASE)).toThrow(/outputFileTracingIncludes/);
    } finally {
      cwd.mockRestore();
      vi.resetModules();
    }
  });
});
