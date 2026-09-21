import { describe, expect, it } from 'vitest';
import { validarCobro, validarCobroManual, type DatosCobro } from './cobros';

// La validación de los cobros: la compartida (`validarCobro`) y la del cobro que FM registra a mano
// (`validarCobroManual`, que usa accionRegistrarCobro). Puras: el resto del alta se prueba en cobros.test.ts
// contra la base.
//
// MUTATION-TESTING (cada fila se corrió):
//   - quitar la reserva del método «Wompi»                  → falla "un cobro pendiente con el método Wompi se rechaza…"
//   - distinguir mayúsculas y espacios en el método         → falla "un cobro pendiente con el método Wompi se rechaza…" (con ' wompi ')
//   - reservar el método también para un cobro pagado       → falla "un cobro ya pagado con el método Wompi sí se registra"
//   - poner la reserva en el validador compartido           → falla "el cobro que crea la propia app (pendiente, método Wompi) SÍ valida"

const base = (extra: Partial<DatosCobro> = {}): DatosCobro => ({
  periodoDesde: '2026-09-01',
  periodoHasta: '2026-09-30',
  monto: 49,
  estado: 'pendiente',
  metodo: null,
  nota: null,
  pagadoEn: null,
  ...extra,
});

describe('el método «Wompi» es de la app', () => {
  it('un cobro pendiente con el método Wompi se rechaza, sin importar mayúsculas ni espacios', () => {
    for (const metodo of ['Wompi', 'wompi', ' WOMPI ']) {
      expect(validarCobroManual(base({ metodo }))).toBe(
        'El método «Wompi» lo reserva la app para los pagos que inicia el dueño. Usá otro método, o registrá el cobro ya pagado.',
      );
    }
  });

  it('un cobro ya pagado con el método Wompi sí se registra', () => {
    expect(validarCobroManual(base({ estado: 'pagado', pagadoEn: '2026-09-15', metodo: 'Wompi' }))).toBeNull();
  });

  it('el cobro que crea la propia app (pendiente, método Wompi) SÍ valida', () => {
    // crearCobroPendiente valida con exactamente estos datos: rechazarlos rompería todos los pagos.
    expect(validarCobro(base({ metodo: 'Wompi' }))).toBeNull();
  });

  it('cualquier otro método, o ninguno, sigue valiendo', () => {
    expect(validarCobroManual(base({ metodo: 'Transferencia' }))).toBeNull();
    expect(validarCobroManual(base({ metodo: null }))).toBeNull();
    expect(validarCobroManual(base({ metodo: 'Wompi manual' }))).toBeNull();
  });

  it('las reglas de siempre siguen valiendo en el camino manual', () => {
    expect(validarCobroManual(base({ periodoHasta: '2026-08-01' }))).toBe('El período termina antes de empezar.');
  });
});
