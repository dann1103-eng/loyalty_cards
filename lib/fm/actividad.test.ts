import { describe, expect, it } from 'vitest';
import { fusionarActividad, type EventoActividad } from './actividad';

// PURA: fusiona los tres orígenes de actividad reciente del dashboard de FM. Las consultas que arman
// las listas de entrada viven en dashboard.ts (dashboard.test.ts, contra Supabase real).
//
// MUTATION-TESTING (cada fila se corrió, romper → ver fallar con ESE mensaje → restaurar):
//   - ordenar ascendente en vez de descendente        → falla "ordena por fecha descendente"
//   - no recortar a `limite` (devolver todo)          → falla "recorta al límite pedido"
//   - un desempate que reordena (sort no estable)      → falla "un empate de fecha conserva el orden de entrada"

function pago(fecha: string, cuentaId = 'c1'): EventoActividad {
  return { tipo: 'pago', fecha, cuentaNombre: 'Cuenta', monto: 10, cuentaId };
}

describe('fusionarActividad', () => {
  it('ordena por fecha descendente (lo más reciente primero)', () => {
    const eventos: EventoActividad[] = [
      pago('2026-09-01T10:00:00Z'),
      pago('2026-09-03T10:00:00Z'),
      pago('2026-09-02T10:00:00Z'),
    ];

    const r = fusionarActividad(eventos, 10);

    expect(r.map((e) => e.fecha)).toEqual(['2026-09-03T10:00:00Z', '2026-09-02T10:00:00Z', '2026-09-01T10:00:00Z']);
  });

  it('recorta al límite pedido', () => {
    const eventos: EventoActividad[] = [
      pago('2026-09-01T10:00:00Z'),
      pago('2026-09-02T10:00:00Z'),
      pago('2026-09-03T10:00:00Z'),
      pago('2026-09-04T10:00:00Z'),
      pago('2026-09-05T10:00:00Z'),
    ];

    const r = fusionarActividad(eventos, 2);

    expect(r).toHaveLength(2);
    expect(r.map((e) => e.fecha)).toEqual(['2026-09-05T10:00:00Z', '2026-09-04T10:00:00Z']);
  });

  it('un empate de fecha conserva el orden de entrada (estable), no hace falta desempate explícito', () => {
    const misma = '2026-09-01T10:00:00Z';
    const eventos: EventoActividad[] = [
      { tipo: 'cuenta_nueva', fecha: misma, cuentaNombre: 'Primera cuenta', cuentaId: 'a' },
      { tipo: 'solicitud', fecha: misma, cuentaNombre: 'Segunda cuenta', planSolicitado: 'growth', cuentaId: 'b' },
      pago(misma, 'c'),
    ];

    const r = fusionarActividad(eventos, 10);

    expect(r.map((e) => e.cuentaId)).toEqual(['a', 'b', 'c']);
  });

  it('mezcla los tres tipos de evento y no rompe con una lista vacía', () => {
    expect(fusionarActividad([], 5)).toEqual([]);

    const eventos: EventoActividad[] = [
      pago('2026-09-01T10:00:00Z'),
      { tipo: 'cuenta_nueva', fecha: '2026-09-03T10:00:00Z', cuentaNombre: 'Nueva', cuentaId: 'n' },
      { tipo: 'solicitud', fecha: '2026-09-02T10:00:00Z', cuentaNombre: null, planSolicitado: 'pro', cuentaId: 's' },
    ];

    expect(fusionarActividad(eventos, 10).map((e) => e.tipo)).toEqual(['cuenta_nueva', 'solicitud', 'pago']);
  });
});
