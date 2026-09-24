import { describe, it, expect } from 'vitest';
import { ordenReporteCajeros, filtrosRpc, type FilaReporteCajeroAlcance } from './reportes';
import { resolverFiltrosReportes, type ContextoReportes } from './filtrosReportes';

// Las dos piezas PURAS de reportes.ts, sin base: el orden antifraude de la hoja Cajeros y el paso de
// los filtros resueltos a los argumentos de las RPC. Lo que necesita PostgREST está en
// reportesConFiltros.test.ts.
//
// MUTATION-TESTING (corridas el 2026-09-24, una por vez y restauradas; con el mensaje que se vio caer):
// - ordenReporteCajeros sin la clave de sospecha (la línea `b.forzadas + b.ajustes - …` borrada): cae
//   "dentro de cada comercio: primero el más sospechoso…" con `expected [ 'alfa@ejemplo.test', …(6) ]
//   to deeply equal [ 'zeta@ejemplo.test', …(6) ]` (queda el orden por email). También cae la prueba
//   contra la base (ver reportesConFiltros.test.ts).
// - ordenReporteCajeros sin el "Sin registrar" al final (la línea `Number(a.cajero_usuario_id ===
//   null) - …` borrada): cae la misma con `expected [ null, 'zeta@ejemplo.test', …(5) ] to deeply equal
//   [ 'zeta@ejemplo.test', …(6) ]`. SOLO esta prueba la ve: la fila sin cajero tiene acá más forzadas
//   que nadie, a propósito; en el escenario de la base no tiene ninguna y quedaría última igual.
// - filtrosRpc cruzando sucursal y cajero: cae "con 'Desde siempre'…" con `expected { comercioIds: [
//   'cafe' ], …(4) } to deeply equal { comercioIds: [ 'cafe' ], …(4) }`.

type FilaOrden = Pick<FilaReporteCajeroAlcance, 'comercio_id' | 'cajero_usuario_id' | 'cajero_email' | 'forzadas' | 'ajustes'>;

const A = 'aaaaaaaa-0000-4000-8000-000000000000';
const B = 'bbbbbbbb-0000-4000-8000-000000000000';

function fila(comercio: string, email: string | null, forzadas: number, ajustes: number, id?: string): FilaOrden {
  return {
    comercio_id: comercio,
    // Sin email no hay cajero: es el grupo "Sin registrar".
    cajero_usuario_id: email === null ? null : (id ?? `id-${email}`),
    cajero_email: email,
    forzadas,
    ajustes,
  };
}

describe('ordenReporteCajeros (el orden de reporte_cajeros_alcance, 0040)', () => {
  it('dentro de cada comercio: primero el más sospechoso (forzadas + correcciones), "Sin registrar" al final', () => {
    // El orden por email y el de sospecha NO coinciden: zeta es el más sospechoso y el último por email.
    // La fila sin cajero tiene más forzadas que nadie y va igual al final de SU comercio. El comercio B
    // va después de todo A aunque su cajero sea el más sospechoso de los dos.
    const filas: FilaOrden[] = [
      fila(B, 'aaa@ejemplo.test', 9, 9),
      fila(A, null, 5, 0),
      fila(A, 'alfa@ejemplo.test', 0, 0),
      fila(A, 'beta@ejemplo.test', 1, 0),
      fila(A, 'gamma@ejemplo.test', 0, 1),
      fila(A, 'medio@ejemplo.test', 0, 2),
      fila(A, 'zeta@ejemplo.test', 2, 1),
    ];
    const ordenadas = [...filas].sort(ordenReporteCajeros);
    expect(ordenadas.map((f) => f.cajero_email)).toEqual([
      'zeta@ejemplo.test', // 3
      'medio@ejemplo.test', // 2
      'beta@ejemplo.test', // 1, empata con gamma: desempata el email
      'gamma@ejemplo.test', // 1
      'alfa@ejemplo.test', // 0
      null, // "Sin registrar", con 5
      'aaa@ejemplo.test', // comercio B
    ]);
  });

  it('empatados en todo lo demás, desempata cajero_usuario_id: el orden es total', () => {
    const uno = fila(A, 'caja@ejemplo.test', 1, 1, '00000000-0000-4000-8000-000000000001');
    const dos = fila(A, 'caja@ejemplo.test', 1, 1, '00000000-0000-4000-8000-000000000002');
    expect([dos, uno].sort(ordenReporteCajeros)).toEqual([uno, dos]);
    expect(ordenReporteCajeros(uno, uno)).toBe(0);
  });
});

describe('filtrosRpc (de los filtros resueltos a los argumentos de las RPC)', () => {
  // El contexto como lo devolvería cargarContextoReportes para un dueño con un solo comercio.
  const comercios = [{ comercioId: 'cafe', nombre: 'Café' }];
  const contexto: ContextoReportes<{ id: string }, { id: string }> = {
    zonaComercioActivo: 'America/El_Salvador',
    datosComercios: [{ comercioId: 'cafe', zonaHoraria: 'America/El_Salvador', tipoPrincipal: 'puntos' }],
    comercioDeLasListas: 'cafe',
    sucursales: [{ id: 'suc-1' }],
    usuarios: [{ id: 'usu-1' }],
  };
  // 12:00 en El Salvador: lejos de la medianoche, el "hoy" no depende de la zona del proceso.
  const ahora = new Date('2026-09-24T18:00:00Z');

  it('con "Desde siempre", desde null y hasta hoy; la sucursal y el cajero, cada uno en SU argumento', () => {
    const filtros = resolverFiltrosReportes(comercios, { periodo: 'todo', sucursal: 'suc-1', cajero: 'usu-1' }, contexto, ahora);
    expect(filtrosRpc(filtros)).toEqual({
      comercioIds: ['cafe'],
      desde: null,
      hasta: '2026-09-24',
      sucursalId: 'suc-1',
      cajeroId: 'usu-1',
    });
  });

  it('con un rango, las dos fechas; sin sucursal ni cajero, null', () => {
    const filtros = resolverFiltrosReportes(
      comercios,
      { periodo: 'rango', desde: '2026-03-09', hasta: '2026-03-12' },
      contexto,
      ahora,
    );
    expect(filtrosRpc(filtros)).toEqual({
      comercioIds: ['cafe'],
      desde: '2026-03-09',
      hasta: '2026-03-12',
      sucursalId: null,
      cajeroId: null,
    });
  });

  it('con "Todo" (dos comercios), el alcance entero', () => {
    const dos = [...comercios, { comercioId: 'spa', nombre: 'Spa' }];
    const filtros = resolverFiltrosReportes(
      dos,
      { periodo: 'todo' },
      {
        ...contexto,
        datosComercios: [...contexto.datosComercios, { comercioId: 'spa', zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' }],
        comercioDeLasListas: null,
        sucursales: [],
        usuarios: [],
      },
      ahora,
    );
    expect(filtrosRpc(filtros).comercioIds).toEqual(['cafe', 'spa']);
  });
});
