import { describe, it, expect } from 'vitest';
import {
  desfaseDeAgarre,
  posicionArrastrada,
  moverConTeclado,
  PASO_TECLADO,
  PASO_TECLADO_GRANDE,
  type CajaVista,
} from './arrastre';

// Una vista previa de 260 × 260 (el sticker cuadrado) que arranca en (100, 50) de la pantalla. Los
// dos offsets son distintos de cero A PROPÓSITO: con left=top=0, una implementación que se olvide de
// restar el origen de la caja pasaría todas las pruebas.
const CAJA: CajaVista = { left: 100, top: 50, width: 260, height: 260 };
const SIN_MEDIR: CajaVista = { left: 0, top: 0, width: 0, height: 0 };

describe('desfaseDeAgarre', () => {
  // El corazón de que el arrastre se sienta bien. Agarrar una franja por su borde derecho y ver que
  // se va sola media pantalla es el bug clásico de esto.
  it('mide la distancia entre el ancla y el punto donde se agarró', () => {
    // Puntero en el centro de la caja (50%, 50%); el elemento está anclado en (20, 80).
    const d = desfaseDeAgarre({ x: 230, y: 180 }, CAJA, { x: 20, y: 80 });
    expect(d.x).toBeCloseTo(-30, 5);
    expect(d.y).toBeCloseTo(30, 5);
  });

  it('agarrar el elemento justo en su ancla no deja desfase', () => {
    // 20% de 260 = 52 → x = 100 + 52; 80% de 260 = 208 → y = 50 + 208.
    const d = desfaseDeAgarre({ x: 152, y: 258 }, CAJA, { x: 20, y: 80 });
    expect(d.x).toBeCloseTo(0, 5);
    expect(d.y).toBeCloseTo(0, 5);
  });

  it('una caja sin medir no produce NaN', () => {
    expect(desfaseDeAgarre({ x: 10, y: 10 }, SIN_MEDIR, { x: 20, y: 80 })).toEqual({ x: 0, y: 0 });
  });
});

describe('posicionArrastrada', () => {
  const actual = { x: 20, y: 80 };

  it('traduce el puntero a porcentajes del lienzo', () => {
    const p = posicionArrastrada({ x: 230, y: 180 }, CAJA, { x: 0, y: 0 }, actual);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(50, 5);
  });

  // Las dos mitades juntas: agarrar y mover tiene que dejar el elemento exactamente donde estaba
  // más lo que se movió el dedo, ni un pixel más.
  it('agarrar y soltar sin mover deja el elemento donde estaba', () => {
    const puntero = { x: 300, y: 120 };
    const desfase = desfaseDeAgarre(puntero, CAJA, actual);
    const p = posicionArrastrada(puntero, CAJA, desfase, actual);
    expect(p.x).toBeCloseTo(actual.x, 5);
    expect(p.y).toBeCloseTo(actual.y, 5);
  });

  it('mover el dedo 26 px a la derecha mueve el elemento 10% (26 de 260)', () => {
    const puntero = { x: 300, y: 120 };
    const desfase = desfaseDeAgarre(puntero, CAJA, actual);
    const p = posicionArrastrada({ x: 326, y: 120 }, CAJA, desfase, actual);
    expect(p.x).toBeCloseTo(30, 5);
    expect(p.y).toBeCloseTo(80, 5);
  });

  // Arrastrar fuera de la vista previa deja el elemento pegado al borde. Sin esto se guardaría un
  // -40% que ni el deslizador ni sanearElementos pueden representar, y el elemento se imprimiría
  // fuera del papel: no falla nada, simplemente no está.
  it('recorta a los bordes del lienzo', () => {
    const fueraArriba = posicionArrastrada({ x: -500, y: -500 }, CAJA, { x: 0, y: 0 }, actual);
    expect(fueraArriba).toEqual({ x: 0, y: 0 });
    const fueraAbajo = posicionArrastrada({ x: 5000, y: 5000 }, CAJA, { x: 0, y: 0 }, actual);
    expect(fueraAbajo).toEqual({ x: 100, y: 100 });
  });

  // Devuelve la posición ACTUAL, no el origen: si devolviera {0,0}, tocar un elemento antes de que
  // el contenedor se mida lo mandaría a la esquina superior izquierda sin que nadie lo arrastrara.
  it('una caja sin medir deja el elemento quieto', () => {
    expect(posicionArrastrada({ x: 10, y: 10 }, SIN_MEDIR, { x: 0, y: 0 }, actual)).toEqual(actual);
  });

  it('una caja de alto cero tampoco produce NaN', () => {
    const p = posicionArrastrada({ x: 200, y: 60 }, { ...CAJA, height: 0 }, { x: 0, y: 0 }, actual);
    expect(p).toEqual(actual);
  });
});

describe('moverConTeclado', () => {
  const actual = { x: 50, y: 50 };

  it('cada flecha mueve en su eje', () => {
    expect(moverConTeclado(actual, 'ArrowLeft', false)).toEqual({ x: 50 - PASO_TECLADO, y: 50 });
    expect(moverConTeclado(actual, 'ArrowRight', false)).toEqual({ x: 50 + PASO_TECLADO, y: 50 });
    expect(moverConTeclado(actual, 'ArrowUp', false)).toEqual({ x: 50, y: 50 - PASO_TECLADO });
    expect(moverConTeclado(actual, 'ArrowDown', false)).toEqual({ x: 50, y: 50 + PASO_TECLADO });
  });

  it('con Shift el paso es más grande', () => {
    expect(moverConTeclado(actual, 'ArrowRight', true)).toEqual({ x: 50 + PASO_TECLADO_GRANDE, y: 50 });
  });

  it('no se pasa de los bordes', () => {
    expect(moverConTeclado({ x: 0, y: 100 }, 'ArrowLeft', true)).toEqual({ x: 0, y: 100 });
    expect(moverConTeclado({ x: 0, y: 100 }, 'ArrowDown', true)).toEqual({ x: 0, y: 100 });
  });

  // null y no `actual`: quien llama usa ese null para NO cancelar el evento. Si la manija se tragara
  // todas las teclas, Tab dejaría de mover el foco y sería una trampa para quien navega con teclado.
  it('devuelve null para una tecla que no es suya', () => {
    for (const tecla of ['Tab', 'Enter', 'a', ' ']) {
      expect(moverConTeclado(actual, tecla, false), `${tecla} no debería mover nada`).toBeNull();
    }
  });
});
