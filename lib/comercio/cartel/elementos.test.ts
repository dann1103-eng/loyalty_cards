import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { dibujarTextoConFuenteDelSistema } from './texto';
import {
  sanearElementos,
  dibujarFranjas,
  dibujarTextosExtra,
  MAX_ELEMENTOS,
  type ElementoCartel,
  type ElementoTexto,
} from './elementos';

const TEXTO_OK = { tipo: 'texto', texto: 'Hola', x: 50, y: 80, tamano: 4, color: 'rgb(1, 2, 3)', peso: 700 };
const FRANJA_OK = { tipo: 'franja', x: 0, y: 90, ancho: 100, alto: 6, color: 'rgb(9, 9, 9)', radio: 0 };

describe('sanearElementos — lo que NO se puede dibujar, no pasa', () => {
  it('acepta un texto y una franja bien formados', () => {
    expect(sanearElementos([TEXTO_OK, FRANJA_OK])).toEqual([TEXTO_OK, FRANJA_OK]);
  });

  it('devuelve [] cuando la columna no trae una lista', () => {
    for (const basura of [null, undefined, 'texto', 42, { tipo: 'texto' }]) {
      expect(sanearElementos(basura), `${JSON.stringify(basura)} no es una lista`).toEqual([]);
    }
  });

  // LA prueba de seguridad de este módulo: el color se interpola CRUDO dentro del atributo fill de
  // un <rect>. Sin este filtro, un valor guardado a mano cierra la comilla y mete markup propio en
  // el SVG que después se rasteriza del lado del servidor.
  it('descarta el elemento entero si el color no es un rgb() legítimo', () => {
    const inyeccion = { ...FRANJA_OK, color: '"/><script>alert(1)</script><rect fill="red' };
    expect(sanearElementos([inyeccion, FRANJA_OK])).toEqual([FRANJA_OK]);
    expect(sanearElementos([{ ...TEXTO_OK, color: 'red' }])).toEqual([]);
  });

  it('descarta el elemento si una coordenada no es un número', () => {
    expect(sanearElementos([{ ...TEXTO_OK, x: '50' }])).toEqual([]);
    expect(sanearElementos([{ ...FRANJA_OK, y: NaN }])).toEqual([]);
    expect(sanearElementos([{ ...FRANJA_OK, ancho: null }])).toEqual([]);
  });

  it('recorta al rango los números finitos que se salen', () => {
    const [texto] = sanearElementos([{ ...TEXTO_OK, x: 140, y: -20, tamano: 900 }]);
    expect(texto).toMatchObject({ x: 100, y: 0, tamano: 15 });
  });

  it('descarta un texto vacío o en blanco, y recorta el largo a 60', () => {
    expect(sanearElementos([{ ...TEXTO_OK, texto: '   ' }])).toEqual([]);
    const [texto] = sanearElementos([{ ...TEXTO_OK, texto: 'a'.repeat(90) }]);
    expect((texto as { texto: string }).texto).toHaveLength(60);
  });

  it('descarta un tipo que no existe', () => {
    expect(sanearElementos([{ ...TEXTO_OK, tipo: 'video' }, FRANJA_OK])).toEqual([FRANJA_OK]);
  });

  it('cae al peso 400 si el peso guardado no es uno de los tres que hay fuente', () => {
    // 300 no tiene archivo .ttf en el repo: dibujarTextoConInter reventaría al buscarlo.
    const [texto] = sanearElementos([{ ...TEXTO_OK, peso: 300 }]);
    expect((texto as { peso: number }).peso).toBe(400);
  });

  it(`corta en ${MAX_ELEMENTOS} elementos`, () => {
    const muchos = Array.from({ length: MAX_ELEMENTOS + 5 }, () => ({ ...FRANJA_OK }));
    expect(sanearElementos(muchos)).toHaveLength(MAX_ELEMENTOS);
  });

  // El tope de acá y el CHECK de la migración son el MISMO número por acoplamiento, no por
  // casualidad: si el de TypeScript sube y el de la base no, guardar revienta con un error de
  // constraint que la pantalla no sabe traducir y el dueño ve "algo salió mal" sin más.
  it('MAX_ELEMENTOS coincide con el CHECK de la migración 0030', () => {
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase', 'migrations', '0030_elementos_cartel.sql'),
      'utf8',
    );
    const m = sql.match(/jsonb_array_length\(elementos\)\s*<=\s*(\d+)/);
    expect(m, 'la 0030 ya no acota la cantidad de elementos').not.toBeNull();
    expect(Number(m![1])).toBe(MAX_ELEMENTOS);
  });
});

describe('dibujarFranjas', () => {
  const franjas: ElementoCartel[] = [
    { tipo: 'franja', x: 10, y: 50, ancho: 80, alto: 10, color: 'rgb(255, 0, 0)', radio: 0 },
  ];

  it('traduce los porcentajes a unidades del lienzo', () => {
    // 400 × 600: x=10% → 40, y=50% → 300, ancho=80% → 320, alto=10% → 60.
    expect(dibujarFranjas(franjas, 400, 600)).toContain(
      '<rect x="40.00" y="300.00" width="320.00" height="60.00"',
    );
  });

  // Contra el lado MAYOR, esta franja (320 × 60) pediría rx=160: más del doble de su propia altura.
  it('mide el radio contra el lado MENOR de la franja', () => {
    const [pildora] = [{ ...franjas[0], radio: 50 }] as ElementoCartel[];
    expect(dibujarFranjas([pildora], 400, 600)).toContain('rx="30.00"');
  });

  it('ignora los textos', () => {
    expect(dibujarFranjas([{ ...TEXTO_OK, peso: 700 } as ElementoCartel], 400, 600)).toBe('');
  });
});

describe('dibujarTextosExtra', () => {
  const textos: ElementoCartel[] = [
    { tipo: 'texto', texto: 'Feliz día', x: 25, y: 50, tamano: 5, color: 'rgb(0, 0, 0)', peso: 600 },
  ];

  it('traduce los porcentajes, y el CUERPO se mide contra el alto', () => {
    const svg = dibujarTextosExtra(textos, 400, 600, dibujarTextoConFuenteDelSistema);
    // x=25% de 400 → 100; y=50% de 600 → 300; tamaño=5% del ALTO (600) → 30, no del ancho.
    expect(svg).toContain('x="100"');
    expect(svg).toContain('y="300"');
    expect(svg).toContain('font-size="30"');
  });

  it('ancla al centro: es la única lectura intuitiva de un control de posición', () => {
    expect(dibujarTextosExtra(textos, 400, 600, dibujarTextoConFuenteDelSistema)).toContain(
      'text-anchor="middle"',
    );
  });

  // El escapado lo hace el dibujante que se le pasa (el mismo de todo el cartel); acá se verifica
  // que este camino no lo saltee interpolando por su cuenta.
  it('el texto libre sale escapado', () => {
    const conAmpersand: ElementoCartel[] = [{ ...(textos[0] as ElementoTexto), texto: 'Café & Té' }];
    expect(dibujarTextosExtra(conAmpersand, 400, 600, dibujarTextoConFuenteDelSistema)).toContain(
      'Café &amp; Té',
    );
  });

  it('ignora las franjas', () => {
    expect(
      dibujarTextosExtra([FRANJA_OK as ElementoCartel], 400, 600, dibujarTextoConFuenteDelSistema),
    ).toBe('');
  });
});
