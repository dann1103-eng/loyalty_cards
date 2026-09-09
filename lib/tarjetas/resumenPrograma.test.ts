import { describe, it, expect } from 'vitest';
import {
  resumenPrograma,
  textoCarta,
  type CartaResumen,
  type FilaResumen,
  type ProgramaDelResumen,
} from './resumenPrograma';

// La métrica del panel del dueño. Antes era UNA suma global de `puntos_actuales` sobre todas las
// tarjetas del comercio, rotulada `esSellos ? 'Sellos vigentes' : 'Puntos vigentes'`. O sea:
//   membresía → "PUNTOS VIGENTES 0" (el reclamo literal del usuario)
//   gift card → "125000 puntos" sobre $1 250.00 circulantes
//   dos programas de tipos distintos → sellos sumados con centavos, sin unidad posible
// Acá se prueba lo que el spec (decisión 2) fija: una pregunta por FAMILIA de tipo, no una etiqueta
// mejor sobre el mismo número.
//
// Las aserciones van sobre `textoCarta` y no sobre `valor` pelado: la carta parte el texto en dos
// tamaños, pero lo que le importa al dueño es la línea completa que lee.

const HOY = '2026-09-09';

function programa(id: string, tipoTarjeta: string, extra: Partial<ProgramaDelResumen> = {}): ProgramaDelResumen {
  return { id, nombre: `Programa ${id}`, tipoTarjeta, selloMeta: null, activo: true, ...extra };
}

function fila(programaId: string, extra: Partial<FilaResumen> = {}): FilaResumen {
  return {
    programa_id: programaId,
    puntos_actuales: 0,
    vigencia_hasta: null,
    usado_en: null,
    acumulado_centavos: 0,
    ...extra,
  };
}

// La línea completa que ve el dueño, encabezado incluido: "SELLOS VIGENTES · 1240 sellos · sin canjear".
function linea(carta: CartaResumen): string {
  return `${carta.etiqueta} · ${textoCarta(carta)} · ${carta.detalle}`;
}

describe('resumenPrograma', () => {
  describe('familia contador entero: la suma, en su unidad', () => {
    it('sellos: "Sellos vigentes · 1240 sellos · sin canjear"', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'sellos', { selloMeta: 10 })],
        [fila('p1', { puntos_actuales: 1200 }), fila('p1', { puntos_actuales: 40 })],
        [],
        HOY,
      );
      expect(cartas).toEqual([
        {
          programaId: 'p1',
          nombre: null,
          etiqueta: 'Sellos vigentes',
          valor: '1240',
          unidad: 'sellos',
          detalle: 'sin canjear',
        },
      ]);
      expect(linea(cartas![0])).toBe('Sellos vigentes · 1240 sellos · sin canjear');
    });

    it('prepago cuenta VISITAS y no se "canjean": se usan', () => {
      const cartas = resumenPrograma([programa('p1', 'prepago')], [fila('p1', { puntos_actuales: 3 })], [], HOY);
      expect(linea(cartas![0])).toBe('Visitas vigentes · 3 visitas · sin usar');
    });

    it('exactamente uno va en singular ("1 punto", no "1 puntos")', () => {
      const cartas = resumenPrograma([programa('p1', 'puntos')], [fila('p1', { puntos_actuales: 1 })], [], HOY);
      expect(linea(cartas![0])).toBe('Puntos vigentes · 1 punto · sin canjear');
    });
  });

  describe('familia contador centavos: la suma con formatearCentavos', () => {
    it('gift card de $25.00 dice "$25.00", NUNCA "2500" ni "2500 puntos"', () => {
      // MUTACIÓN OBLIGATORIA (spec, decisión 2): devolver el entero crudo en la rama de centavos
      // —`valor: String(suma)` en vez de `formatearCentavos(suma)`— reproduce exactamente el bug de
      // origen del 2026-07-30, "2500 puntos" sobre una gift card de $25.00. Esta prueba tiene que
      // fallar con ese cambio.
      const cartas = resumenPrograma([programa('p1', 'gift_card')], [fila('p1', { puntos_actuales: 2500 })], [], HOY);
      expect(cartas).toEqual([
        {
          programaId: 'p1',
          nombre: null,
          etiqueta: 'Saldo en tarjetas',
          valor: '$25.00',
          // Vacía a propósito: el valor ya es dinero, y ponerle una palabra al lado es el bug.
          unidad: '',
          detalle: 'saldo circulante',
        },
      ]);
      expect(linea(cartas![0])).toBe('Saldo en tarjetas · $25.00 · saldo circulante');
      expect(textoCarta(cartas![0])).not.toContain('puntos');
    });

    it('cashback suma los saldos de todas sus tarjetas antes de formatear', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'cashback')],
        [fila('p1', { puntos_actuales: 125000 }), fila('p1', { puntos_actuales: 1 })],
        [],
        HOY,
      );
      expect(textoCarta(cartas![0])).toBe('$1250.01');
    });
  });

  describe('familia usaVigencia: cuántas siguen vigentes hoy, contra el total', () => {
    it('membresía: "2 activas · de 4" — la que no tiene fecha está SIN ACTIVAR y no cuenta', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'membresia')],
        [
          fila('p1', { vigencia_hasta: '2026-12-31' }),
          fila('p1', { vigencia_hasta: '2026-01-01' }), // vencida
          fila('p1', { vigencia_hasta: null }), // sin activar
          fila('p1', { vigencia_hasta: '2026-09-09' }), // vence HOY: sigue activa el día completo
        ],
        [],
        HOY,
      );
      expect(cartas![0]).toEqual({
        programaId: 'p1',
        nombre: null,
        etiqueta: 'Socios activos',
        valor: '2',
        unidad: 'activas',
        detalle: 'de 4',
      });
      expect(linea(cartas![0])).toBe('Socios activos · 2 activas · de 4');
    });

    it('membresía con una sola activa va en singular', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'membresia')],
        [fila('p1', { vigencia_hasta: '2026-12-31' })],
        [],
        HOY,
      );
      expect(textoCarta(cartas![0])).toBe('1 activa');
    });

    it('cupón: el YA USADO no está disponible aunque la fecha aguante', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'cupon')],
        [
          fila('p1', { vigencia_hasta: '2026-12-31' }),
          fila('p1', { vigencia_hasta: '2026-12-31', usado_en: '2026-09-01T10:00:00Z' }),
        ],
        [],
        HOY,
      );
      expect(linea(cartas![0])).toBe('Cupones vigentes · 1 vigente · de 2');
    });

    it('cupón SIN fecha no vence nunca y sigue contando (membresía sin fecha, no)', () => {
      // sigueVigente(null) devuelve false, así que la trampa está en aplicarle la misma regla a los
      // dos tipos: para el cupón, `vigencia_hasta = null` es "no vence" (describirSaldo dice
      // "Disponible"); para la membresía es "Sin activar".
      const cupones = resumenPrograma([programa('p1', 'cupon')], [fila('p1', { vigencia_hasta: null })], [], HOY);
      expect(textoCarta(cupones![0])).toBe('1 vigente');

      const membresias = resumenPrograma(
        [programa('p2', 'membresia')],
        [fila('p2', { vigencia_hasta: null })],
        [],
        HOY,
      );
      expect(textoCarta(membresias![0])).toBe('0 activas');
    });
  });

  describe('familia descuento: cuántos clientes ya alcanzaron un nivel', () => {
    const niveles = [
      { desdeCentavos: 10000, porcentaje: 5 },
      { desdeCentavos: 50000, porcentaje: 10 },
    ];

    it('"2 con descuento · de 4" — el que no llegó al primer umbral no cuenta', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'descuento')],
        [
          fila('p1', { acumulado_centavos: 9999 }),
          fila('p1', { acumulado_centavos: 10000 }), // justo en el umbral: cuenta
          fila('p1', { acumulado_centavos: 800000 }),
          fila('p1', { acumulado_centavos: 0 }),
        ],
        niveles,
        HOY,
      );
      expect(cartas![0]).toEqual({
        programaId: 'p1',
        nombre: null,
        etiqueta: 'Clientes con descuento',
        valor: '2',
        unidad: 'con descuento',
        detalle: 'de 4',
      });
      expect(linea(cartas![0])).toBe('Clientes con descuento · 2 con descuento · de 4');
    });

    it('acumulado_centavos puede llegar como string (bigint del driver) y se cuenta igual', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'descuento')],
        [fila('p1', { acumulado_centavos: '600000' })],
        niveles,
        HOY,
      );
      expect(textoCarta(cartas![0])).toBe('1 con descuento');
    });

    it('sin niveles configurados nadie tiene descuento todavía', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'descuento')],
        [fila('p1', { acumulado_centavos: 900000 })],
        [],
        HOY,
      );
      expect(textoCarta(cartas![0])).toBe('0 con descuento');
    });
  });

  describe('qué cartas se dibujan', () => {
    it('un comercio SIN NINGUNA tarjeta no ve carta: devuelve null (arriba está el tutorial)', () => {
      expect(resumenPrograma([programa('p1', 'sellos')], [], [], HOY)).toBeNull();
    });

    it('sin programas activos tampoco hay carta', () => {
      expect(resumenPrograma([], [fila('p1', { puntos_actuales: 5 })], [], HOY)).toBeNull();
    });

    it('con UN solo programa la carta va sin nombre (sería ruido)', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'sellos', { nombre: 'Café del Centro' })],
        [fila('p1', { puntos_actuales: 5 })],
        [],
        HOY,
      );
      expect(cartas).toHaveLength(1);
      expect(cartas![0].nombre).toBeNull();
    });

    it('con DOS programas hay una carta por programa, con su nombre, y los saldos NO se mezclan', () => {
      // El caso que hoy da un número no interpretable en ninguna unidad: sellos + centavos sumados.
      const cartas = resumenPrograma(
        [
          programa('p1', 'sellos', { nombre: 'Tarjeta de sellos' }),
          programa('p2', 'gift_card', { nombre: 'Gift card' }),
        ],
        [fila('p1', { puntos_actuales: 12 }), fila('p2', { puntos_actuales: 2500 })],
        [],
        HOY,
      );
      expect(cartas).toEqual([
        {
          programaId: 'p1',
          nombre: 'Tarjeta de sellos',
          etiqueta: 'Sellos vigentes',
          valor: '12',
          unidad: 'sellos',
          detalle: 'sin canjear',
        },
        {
          programaId: 'p2',
          nombre: 'Gift card',
          etiqueta: 'Saldo en tarjetas',
          valor: '$25.00',
          unidad: '',
          detalle: 'saldo circulante',
        },
      ]);
    });

    it('un programa DESACTIVADO no tiene carta, y sus tarjetas no engordan la del activo', () => {
      const cartas = resumenPrograma(
        [programa('p1', 'sellos'), programa('p2', 'sellos', { activo: false })],
        [fila('p1', { puntos_actuales: 10 }), fila('p2', { puntos_actuales: 90 })],
        [],
        HOY,
      );
      expect(cartas).toHaveLength(1);
      expect(cartas![0].programaId).toBe('p1');
      expect(textoCarta(cartas![0])).toBe('10 sellos');
    });

    it('un tipo desconocido no deja la pantalla sin dibujar: degrada a puntos', () => {
      const cartas = resumenPrograma([programa('p1', 'lo_que_sea')], [fila('p1', { puntos_actuales: 7 })], [], HOY);
      expect(textoCarta(cartas![0])).toBe('7 puntos');
    });
  });
});
