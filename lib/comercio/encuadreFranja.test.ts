// lib/comercio/encuadreFranja.test.ts
import { describe, it, expect } from 'vitest';
import {
  ENCUADRE_POR_DEFECTO,
  MARCO_FRANJA,
  colocarFoto,
  rectanguloVisible,
  focoTrasArrastre,
  validarEncuadre,
  encuadreDesdeFormulario,
  encuadreDelComercio,
  encuadreDelPrograma,
  porcentajesDeColocacion,
  type Encuadre,
} from './encuadreFranja';

// Foto apaisada 2:1 sobre el marco de la franja (375:123 ≈ 3.05:1): en 'llenar' sobra ALTO, en
// 'completa' sobra ANCHO. Con estos dos números todos los casos tienen holgura en un solo eje, lo
// que hace las aserciones exactas.
const FOTO = { ancho: 200, alto: 100 };
const MARCO = MARCO_FRANJA;

function encuadre(sobre: Partial<Encuadre> = {}): Encuadre {
  return { ...ENCUADRE_POR_DEFECTO, ...sobre };
}

describe('colocarFoto', () => {
  it('con el default reproduce el object-fit: cover centrado de siempre', () => {
    // escala = 375/200 = 1.875; alto escalado = 187.5; holgura vertical = 123 − 187.5 = −64.5
    const c = colocarFoto(FOTO, MARCO, encuadre());
    expect(c.ancho).toBeCloseTo(375);
    expect(c.alto).toBeCloseTo(187.5);
    expect(c.left).toBeCloseTo(0);
    expect(c.top).toBeCloseTo(-32.25);
  });

  it('focoY 0 muestra el borde superior y 100 el inferior', () => {
    // MUTACIÓN: invertir el signo de la holgura hace que 0 y 100 se crucen.
    expect(colocarFoto(FOTO, MARCO, encuadre({ focoY: 0 })).top).toBeCloseTo(0);
    expect(colocarFoto(FOTO, MARCO, encuadre({ focoY: 100 })).top).toBeCloseTo(-64.5);
  });

  it("'completa' deja la foto entera dentro del marco y el foco reparte la holgura sobrante", () => {
    // escala = min(375/200, 123/100) = 1.23; ancho escalado = 246; holgura horizontal = 129
    const izquierda = colocarFoto(FOTO, MARCO, encuadre({ modo: 'completa', focoX: 0 }));
    expect(izquierda.ancho).toBeCloseTo(246);
    expect(izquierda.alto).toBeCloseTo(123);
    expect(izquierda.left).toBeCloseTo(0);
    expect(colocarFoto(FOTO, MARCO, encuadre({ modo: 'completa', focoX: 100 })).left).toBeCloseTo(129);
  });

  it('zoom 200 duplica el tamaño sobre la escala base del modo', () => {
    // MUTACIÓN: aplicar el zoom como suma o ignorarlo deja el ancho en 375.
    expect(colocarFoto(FOTO, MARCO, encuadre({ zoom: 200 })).ancho).toBeCloseTo(750);
    expect(colocarFoto(FOTO, MARCO, encuadre({ modo: 'completa', zoom: 200 })).ancho).toBeCloseTo(492);
  });

  it('medidas no positivas: el marco entero, nunca NaN ni Infinity', () => {
    // naturalWidth es 0 hasta el onLoad; un NaN en una coordenada rompe el SVG del cartel entero.
    expect(colocarFoto({ ancho: 0, alto: 0 }, MARCO, encuadre())).toEqual({ left: 0, top: 0, ancho: 375, alto: 123 });
    expect(colocarFoto(FOTO, { ancho: 0, alto: 123 }, encuadre())).toEqual({ left: 0, top: 0, ancho: 0, alto: 123 });
  });
});

describe('rectanguloVisible', () => {
  it('es la inversa de colocarFoto: la ventana de la foto que ocupa el marco', () => {
    // Con default: escala 1.875; ventana = 375/1.875 × 123/1.875 = 200 × 65.6, centrada en Y.
    const r = rectanguloVisible(FOTO, MARCO, encuadre());
    expect(r.x).toBeCloseTo(0);
    expect(r.ancho).toBeCloseTo(200);
    expect(r.alto).toBeCloseTo(65.6);
    expect(r.y).toBeCloseTo(17.2);
  });

  it("en 'completa' la ventana es MÁS GRANDE que la foto (queda fondo alrededor)", () => {
    const r = rectanguloVisible(FOTO, MARCO, encuadre({ modo: 'completa', focoX: 50 }));
    expect(r.ancho).toBeGreaterThan(FOTO.ancho);
    expect(r.x).toBeLessThan(0);
  });

  it('conserva la proporción del marco (por eso el <svg> anidado puede usar preserveAspectRatio="none")', () => {
    const r = rectanguloVisible(FOTO, MARCO, encuadre({ zoom: 175, focoX: 20, focoY: 80 }));
    expect(r.ancho / r.alto).toBeCloseTo(MARCO.ancho / MARCO.alto);
  });

  it('medidas no positivas: la ventana 0 0 marco', () => {
    expect(rectanguloVisible({ ancho: 0, alto: 50 }, MARCO, encuadre())).toEqual({ x: 0, y: 0, ancho: 375, alto: 123 });
  });
});

describe('focoTrasArrastre', () => {
  // Marco de pantalla de 750×246 (el doble del de la franja): holgura vertical = 246 − 375 = −129 px.
  const MARCO_PX = { ancho: 750, alto: 246 };

  it('arrastrar hacia abajo con la foto desbordando BAJA el foco (la foto sigue al dedo)', () => {
    // MUTACIÓN: dividir por |holgura| en vez de por holgura invierte la dirección del arrastre.
    const foco = focoTrasArrastre(encuadre({ focoY: 50 }), { x: 0, y: 12.9 }, FOTO, MARCO_PX);
    expect(foco.focoY).toBeCloseTo(40);
    expect(foco.focoX).toBe(50);
  });

  it("en 'completa' la holgura es positiva y arrastrar a la derecha SUBE el foco", () => {
    // ancho escalado = 200 × 2.46 = 492; holgura horizontal = 258 px
    const foco = focoTrasArrastre(encuadre({ modo: 'completa', focoX: 50 }), { x: 25.8, y: 0 }, FOTO, MARCO_PX);
    expect(foco.focoX).toBeCloseTo(60);
  });

  it('en un eje sin holgura el foco no cambia', () => {
    // 'llenar' con esta foto no deja holgura horizontal (ancho escalado = 750).
    const foco = focoTrasArrastre(encuadre({ focoX: 50 }), { x: 300, y: 0 }, FOTO, MARCO_PX);
    expect(foco.focoX).toBe(50);
  });

  it('más allá del borde se acota a 0 o a 100', () => {
    expect(focoTrasArrastre(encuadre({ focoY: 90 }), { x: 0, y: -100 }, FOTO, MARCO_PX).focoY).toBe(100);
    expect(focoTrasArrastre(encuadre({ focoY: 10 }), { x: 0, y: 100 }, FOTO, MARCO_PX).focoY).toBe(0);
  });

  it('sin medidas de la foto, devuelve el foco tal cual', () => {
    expect(focoTrasArrastre(encuadre({ focoX: 33, focoY: 66 }), { x: 10, y: 10 }, { ancho: 0, alto: 0 }, MARCO_PX)).toEqual({
      focoX: 33,
      focoY: 66,
    });
  });
});

describe('porcentajesDeColocacion', () => {
  it('convierte la colocación a porcentajes del marco (para CSS)', () => {
    const p = porcentajesDeColocacion({ left: -37.5, top: 0, ancho: 750, alto: 123 }, MARCO);
    expect(p).toEqual({ left: -10, top: 0, ancho: 200, alto: 100 });
  });
});

describe('validarEncuadre', () => {
  const valido = { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 };

  it('acepta un encuadre válido', () => {
    expect(validarEncuadre(valido)).toBeNull();
    expect(validarEncuadre({ modo: 'completa', focoX: 0, focoY: 100, zoom: 300 })).toBeNull();
  });

  it('rechaza cada campo con SU mensaje', () => {
    expect(validarEncuadre({ ...valido, modo: 'estirar' })).toBe('El modo de encuadre no es válido.');
    expect(validarEncuadre({ ...valido, focoX: 101 })).toBe('La posición horizontal debe ser un entero de 0 a 100.');
    expect(validarEncuadre({ ...valido, focoY: -1 })).toBe('La posición vertical debe ser un entero de 0 a 100.');
    expect(validarEncuadre({ ...valido, zoom: 99 })).toBe('El zoom debe ser un entero de 100 a 300.');
    expect(validarEncuadre({ ...valido, zoom: 301 })).toBe('El zoom debe ser un entero de 100 a 300.');
  });

  it('rechaza decimales y NaN (Number("") es 0 y pasaría como válido: por eso el formulario manda NaN)', () => {
    expect(validarEncuadre({ ...valido, focoX: 50.5 })).toBe('La posición horizontal debe ser un entero de 0 a 100.');
    expect(validarEncuadre({ ...valido, zoom: NaN })).toBe('El zoom debe ser un entero de 100 a 300.');
  });
});

describe('encuadreDesdeFormulario', () => {
  it('cuatro vacíos → null (el programa hereda)', () => {
    expect(encuadreDesdeFormulario({ modo: '', focoX: '', focoY: '', zoom: '' })).toBeNull();
  });

  it('convierte a números crudos; un vacío suelto llega como NaN para que validarEncuadre lo rechace', () => {
    // MUTACIÓN: `Number(campo)` a secas convierte '' en 0, que es un foco válido: el error se traga.
    expect(encuadreDesdeFormulario({ modo: 'llenar', focoX: '10', focoY: '20', zoom: '150' })).toEqual({
      modo: 'llenar',
      focoX: 10,
      focoY: 20,
      zoom: 150,
    });
    const parcial = encuadreDesdeFormulario({ modo: 'llenar', focoX: '', focoY: '20', zoom: '150' });
    expect(parcial).not.toBeNull();
    expect(Number.isNaN(parcial!.focoX)).toBe(true);
  });
});

describe('encuadreDelComercio / encuadreDelPrograma', () => {
  const fila = { encuadre_franja: 'completa', foco_franja_x: 10, foco_franja_y: 90, zoom_franja: 250 };

  it('lee una fila válida tal cual', () => {
    expect(encuadreDelComercio(fila)).toEqual({ modo: 'completa', focoX: 10, focoY: 90, zoom: 250 });
    expect(encuadreDelPrograma(fila)).toEqual({ modo: 'completa', focoX: 10, focoY: 90, zoom: 250 });
  });

  it('un valor fuera de rango o un modo desconocido hace caer el encuadre ENTERO al default', () => {
    // Lo que sale de la BD es dato hostil (CLAUDE.md). Se lee como unidad: no se "arregla" un campo.
    expect(encuadreDelComercio({ ...fila, zoom_franja: 999 })).toEqual(ENCUADRE_POR_DEFECTO);
    expect(encuadreDelComercio({ ...fila, encuadre_franja: 'raro' })).toEqual(ENCUADRE_POR_DEFECTO);
  });

  it('programa: una sola columna null → null (sin encuadre propio)', () => {
    expect(encuadreDelPrograma({ ...fila, foco_franja_y: null })).toBeNull();
    expect(encuadreDelPrograma({ encuadre_franja: null, foco_franja_x: null, foco_franja_y: null, zoom_franja: null })).toBeNull();
  });
});
