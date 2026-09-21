import { describe, expect, it } from 'vitest';
import { CONCILIACIONES, type Conciliacion } from './confirmarPago';
import { accionesDisponibles, describirPeriodo, entradaParaReintentar, etiquetaConciliacion, necesitaAtencion } from './pagosAdmin';

// PURAS: las reglas del panel de FM. Las consultas a la base se prueban en pagosAdminDb.test.ts.
//
// MUTATION-TESTING (cada fila se corrió; el nombre es la prueba que la atrapa, puede haber otras):
//   - contar los eventos ya revisados como pendientes de atención → falla "un evento revisado ya no necesita atención"
//   - contar un pago de prueba o aplicado como atención           → falla "solo los estados que esperan una decisión de FM necesitan atención"
//   - ofrecer "reintentar" en cualquier estado                    → falla "reintentar solo se ofrece para un error"
//   - ofrecer "aplicar" en un doble pago                          → falla "aplicar solo se ofrece cuando FM puede aceptar el pago"
//   - ofrecer "revisado" aunque ya esté revisado                  → falla "marcar revisado se ofrece mientras el evento necesita atención"
//   - leer las columnas y no el cuerpo al reintentar              → falla "reprocesa un cuerpo que antes no se reconocía"
//   - tratar una declinada como aprobada al reintentar            → falla "una transacción declinada se reintenta como no aprobada"
//   - no separar el singular ("quedan 1 días")                     → falla "un solo día restante va en singular"
//   - no distinguir un período ya renovado del vigente           → falla "un período ya renovado dice hasta cuándo está pagado"
//   - forzar esReal=true / aprobada=true al reintentar un redirect → falla "un evento del redirect de prueba o no aprobado conserva lo que dice el cuerpo"

describe('necesitaAtencion', () => {
  it('solo los estados que esperan una decisión de FM necesitan atención', () => {
    const atencion = CONCILIACIONES.filter((c) => necesitaAtencion({ conciliacion: c, revisadoEn: null }));
    expect(atencion).toEqual(['cobro_anulado', 'monto_distinto', 'ya_pagado', 'plan_no_aplicable', 'error']);
  });

  it('un evento revisado ya no necesita atención', () => {
    expect(necesitaAtencion({ conciliacion: 'monto_distinto', revisadoEn: '2026-09-15T18:00:00Z' })).toBe(false);
  });
});

describe('accionesDisponibles', () => {
  const acciones = (c: Conciliacion, revisadoEn: string | null = null) => accionesDisponibles({ conciliacion: c, revisadoEn });

  it('reintentar solo se ofrece para un error', () => {
    for (const c of CONCILIACIONES) {
      expect(acciones(c).includes('reintentar'), c).toBe(c === 'error');
    }
  });

  it('aplicar solo se ofrece cuando FM puede aceptar el pago: monto distinto o cobro anulado', () => {
    for (const c of CONCILIACIONES) {
      expect(acciones(c).includes('aplicar'), c).toBe(c === 'monto_distinto' || c === 'cobro_anulado');
    }
  });

  it('marcar revisado se ofrece mientras el evento necesita atención, y deja de ofrecerse después', () => {
    expect(acciones('ya_pagado')).toEqual(['revisado']);
    expect(acciones('ya_pagado', '2026-09-15T18:00:00Z')).toEqual([]);
    expect(acciones('aplicado')).toEqual([]);
    expect(acciones('prueba')).toEqual([]);
  });

  it('un error ofrece reintentar y marcar revisado', () => {
    expect(acciones('error')).toEqual(['reintentar', 'revisado']);
  });

  it('aplicar sigue disponible después de marcar revisado (FM puede cambiar de idea)', () => {
    expect(acciones('monto_distinto', '2026-09-15T18:00:00Z')).toEqual(['aplicar']);
  });
});

describe('etiquetaConciliacion', () => {
  it('tiene texto para cada estado', () => {
    for (const c of CONCILIACIONES) expect(etiquetaConciliacion(c).length, c).toBeGreaterThan(0);
    expect(etiquetaConciliacion('ya_pagado')).toBe('Doble pago');
  });
});

describe('entradaParaReintentar', () => {
  const cuerpo = {
    IdTransaccion: 'tx-1', Monto: 49, EsProductiva: true, ResultadoTransaccion: 'ExitosaAprobada',
    FechaTransaccion: '2026-09-15T18:00:00Z', EnlacePago: { Id: 66, IdentificadorEnlaceComercio: 'cobro-1' },
  };

  it('reprocesa un cuerpo que antes no se reconocía (un parser arreglado después)', () => {
    // El evento nació de un cuerpo irreconocible: sus columnas están vacías. Se re-lee el CUERPO.
    const r = entradaParaReintentar({ fuente: 'webhook', identificadorEnlace: null, payload: cuerpo });
    expect(r).toEqual({
      fuente: 'webhook',
      idTransaccion: 'tx-1',
      monto: 49,
      esReal: true,
      aprobada: true,
      identificadorEnlace: 'cobro-1',
      fecha: '2026-09-15T18:00:00.000Z',
      payload: cuerpo,
    });
  });

  it('una transacción declinada se reintenta como no aprobada', () => {
    const r = entradaParaReintentar({ fuente: 'webhook', identificadorEnlace: null, payload: { ...cuerpo, ResultadoTransaccion: 'ExitosaDeclinada' } });
    expect(r).toMatchObject({ aprobada: false });
  });

  it('un cuerpo que sigue sin reconocerse devuelve el motivo', () => {
    const r = entradaParaReintentar({ fuente: 'webhook', identificadorEnlace: null, payload: { algo: 1 } });
    expect(r).toEqual({ error: 'El cuerpo guardado sigue sin reconocerse: falta IdTransaccion.' });
  });

  it('un evento del redirect se reconstruye con el identificador de la columna', () => {
    const r = entradaParaReintentar({
      fuente: 'redirect',
      identificadorEnlace: 'cobro-2',
      payload: { idTransaccion: 'tx-2', esReal: true, esAprobada: true, monto: 29, fecha: '2026-09-15T18:00:00Z' },
    });
    expect(r).toMatchObject({ fuente: 'redirect', idTransaccion: 'tx-2', monto: 29, esReal: true, aprobada: true, identificadorEnlace: 'cobro-2' });
  });

  it('un evento del redirect de prueba o no aprobado conserva lo que dice el cuerpo', () => {
    // Si el reintento lo "arreglara" a real/aprobado, un pago de prueba aplicaría un plan de verdad.
    const r = entradaParaReintentar({
      fuente: 'redirect',
      identificadorEnlace: 'cobro-3',
      payload: { idTransaccion: 'tx-3', esReal: false, esAprobada: false, monto: 29, fecha: null },
    });
    expect(r).toMatchObject({ esReal: false, aprobada: false, fecha: null });
  });

  it('un evento del redirect con un cuerpo raro devuelve un error', () => {
    expect(entradaParaReintentar({ fuente: 'redirect', identificadorEnlace: 'c', payload: { idTransaccion: 'x' } })).toHaveProperty('error');
  });

  it('un pago aplicado a mano no se reintenta: se vuelve a marcar el cobro', () => {
    expect(entradaParaReintentar({ fuente: 'manual', identificadorEnlace: 'c', payload: {} })).toEqual({
      error: 'Un pago aplicado a mano se reintenta volviendo a marcar el cobro como pagado.',
    });
  });
});

describe('describirPeriodo', () => {
  it('sin período pagado', () => {
    expect(describirPeriodo({ tipo: 'sin_periodo' })).toBe('Sin período pagado en la app.');
  });

  it('un período pagado que todavía no empezó', () => {
    expect(describirPeriodo({ tipo: 'futuro', desde: '2026-10-01' })).toBe('Su primer período pagado empieza el 1 de octubre de 2026.');
  });

  it('un período en curso dice hasta cuándo y cuántos días quedan', () => {
    const r = describirPeriodo({
      tipo: 'en_curso', desde: '2026-09-01', hasta: '2026-09-30', cubiertoHasta: '2026-09-30', diasRestantes: 16, diasPeriodo: 30, fase: 'mitad',
    });
    expect(r).toBe('Período pagado hasta el 30 de septiembre de 2026 (quedan 16 días).');
  });

  it('un solo día restante va en singular', () => {
    const r = describirPeriodo({
      tipo: 'en_curso', desde: '2026-09-01', hasta: '2026-09-30', cubiertoHasta: '2026-09-30', diasRestantes: 1, diasPeriodo: 30, fase: 'ventana',
    });
    expect(r).toBe('Período pagado hasta el 30 de septiembre de 2026 (queda 1 día).');
  });

  it('un período ya renovado dice hasta cuándo está pagado', () => {
    const r = describirPeriodo({
      tipo: 'en_curso', desde: '2026-09-01', hasta: '2026-09-30', cubiertoHasta: '2026-10-31', diasRestantes: 5, diasPeriodo: 30, fase: 'ya_renovado',
    });
    expect(r).toBe('Período actual hasta el 30 de septiembre de 2026; ya renovado hasta el 31 de octubre de 2026.');
  });
});
