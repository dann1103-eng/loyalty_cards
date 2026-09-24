import { describe, it, expect } from 'vitest';
import {
  comercioAConsultar,
  resolverFiltrosReportes,
  direccionInicial,
  type ContextoReportes,
} from './filtrosReportes';
import { leerParametrosReportes } from './parametrosReportes';

// Prueba PURA. resolverFiltrosReportes es el candado de "los filtros llegan por querystring —input
// del cliente— y ningún id ajeno llega a una RPC" (spec §1). Vive en una función pura justamente
// para poder mutarla: la página y la ruta del Excel no se prueban, esto sí.
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - El `=== 1` de comercioAConsultar (→ `=== 0`): caen "con UN solo comercio, es ese aunque la URL
//   no lo traiga" y "un solo comercio = elegido: sus filtros de sucursal y cajero funcionan sin
//   ?comercio", las dos con `expected null to be { Object (comercioId, nombre) }`.
// - Sucursal validada sin exigir comercio resuelto (`contexto.sucursales.find(…)` sin el `comercio ?`):
//   caen "un comercio AJENO cae a Todo…" y "sucursal o cajero SIN comercio resuelto…" con `expected
//   { id: 's-centro', nombre: 'Centro' } to be null`. Lo mismo con el cajero: `expected { id: 'u-caja',
//   email: 'caja@cafe.sv' } to be null`.
// - Zona siempre la del activo (`const zonaHoraria = contexto.zonaComercioActivo`): caen tres, entre
//   ellas "con un comercio elegido, los presets se resuelven en SU zona" con `expected
//   'Europe/Madrid' to be 'America/Bogota'` y "rango: el techo es HOY en la zona del comercio elegido"
//   con `expected [ '2026-09-01', '2026-09-23' ] to deeply equal [ '2026-09-01', '2026-09-22' ]`.
// - Sin el techo de hoy (rangoFechas.ts, `techo = (fecha) => fecha`): cae "rango: el techo es HOY en
//   la zona del comercio elegido…" con el mismo mensaje de arriba.
// - Unidades de TODOS los comercios del contexto en vez de las del alcance: cae "acumulado vale si el
//   ALCANCE…" con `expected [ 'visitas', 'desc', false ] to deeply equal [ 'acumulado', 'desc', true ]`.
// - Acumulado aceptado aunque no sea ordenable (`ordenValido = ordenPedido !== undefined`): caen
//   tres, entre ellas "acumulado con unidades MEZCLADAS…" con `expected [ 'acumulado', 'asc', false ]
//   to deeply equal [ 'visitas', 'desc', false ]`.
// - La dir de un orden caído se conserva (sin `ordenValido &&`): caen "orden inválido cae a visitas
//   desc…" con `expected [ 'visitas', 'asc' ] to deeply equal [ 'visitas', 'desc' ]` y "acumulado con
//   unidades MEZCLADAS…" con `expected [ 'visitas', 'asc', false ] to deeply equal [ 'visitas',
//   'desc', false ]`.
// - Página sin el máximo (`pagina >= 1 ? pagina : 1`): cae "página: entero de 1 a 10 000…" con
//   `pagina=10001: expected 10001 to be 1`.

const comercios = [
  { comercioId: 'c-cafe', nombre: 'Café' },
  { comercioId: 'c-spa', nombre: 'Spa' },
];
const sucursalesCafe = [
  { id: 's-centro', nombre: 'Centro' },
  { id: 's-norte', nombre: 'Norte' },
];
const usuariosCafe = [
  { id: 'u-dueno', email: 'dueno@cafe.sv' },
  { id: 'u-caja', email: 'caja@cafe.sv' },
];

// El Café está en Bogotá y el Spa en Madrid; el comercio ACTIVO del switcher es el Spa. 03:00 UTC del
// 23 de septiembre: en Bogotá son las 22:00 del 22, en Madrid las 05:00 del 23. Así se ve en qué zona
// se resolvió un preset.
const AHORA = new Date('2026-09-23T03:00:00Z');

function contexto(
  extra: Partial<ContextoReportes<(typeof sucursalesCafe)[number], (typeof usuariosCafe)[number]>> = {},
): ContextoReportes<(typeof sucursalesCafe)[number], (typeof usuariosCafe)[number]> {
  return {
    zonaComercioActivo: 'Europe/Madrid',
    datosComercios: [
      { comercioId: 'c-cafe', zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' },
      { comercioId: 'c-spa', zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'sellos' },
    ],
    sucursales: [],
    usuarios: [],
    ...extra,
  };
}

// Lo que haría la página con `?…`: leer la querystring y resolver.
function resolver(query: string, ctx = contexto(), duenoDe = comercios) {
  return resolverFiltrosReportes(duenoDe, leerParametrosReportes(new URLSearchParams(query)), ctx, AHORA);
}

describe('comercioAConsultar', () => {
  it('con UN solo comercio, es ese aunque la URL no lo traiga (o traiga otro)', () => {
    const uno = [comercios[0]];
    expect(comercioAConsultar(uno, {})).toBe(uno[0]);
    expect(comercioAConsultar(uno, { comercio: 'c-ajeno' })).toBe(uno[0]);
  });

  it('con dos o más: el de la URL si es suyo; si no, null ("Todo")', () => {
    expect(comercioAConsultar(comercios, {})).toBeNull();
    expect(comercioAConsultar(comercios, { comercio: 'c-spa' })).toBe(comercios[1]);
    expect(comercioAConsultar(comercios, { comercio: 'c-ajeno' })).toBeNull();
  });
});

describe('direccionInicial', () => {
  it('nombre ascendente; el resto descendente', () => {
    expect(direccionInicial('nombre')).toBe('asc');
    for (const orden of ['visitas', 'acumulado', 'premios', 'ultima'] as const) {
      expect(direccionInicial(orden), orden).toBe('desc');
    }
  });
});

describe('resolverFiltrosReportes', () => {
  it('sin parámetros: 30 días en la zona del comercio ACTIVO, "Todo", visitas desc, página 1', () => {
    expect(resolver('')).toEqual({
      periodo: '30d',
      desde: '2026-08-25',
      hasta: '2026-09-23', // Madrid (activo): ya es el 23
      zonaHoraria: 'Europe/Madrid',
      comercio: null,
      alcance: comercios,
      sucursal: null,
      cajero: null,
      orden: 'visitas',
      dir: 'desc',
      pagina: 1,
      acumuladoOrdenable: false, // puntos + sellos
    });
  });

  it('con un comercio elegido, los presets se resuelven en SU zona', () => {
    const f = resolver('comercio=c-cafe&periodo=hoy', contexto({ sucursales: sucursalesCafe }));
    expect(f.comercio).toBe(comercios[0]);
    expect(f.alcance).toEqual([comercios[0]]);
    expect(f.zonaHoraria).toBe('America/Bogota');
    expect([f.desde, f.hasta]).toEqual(['2026-09-22', '2026-09-22']); // Bogotá: todavía el 22
  });

  describe('período', () => {
    it('inválido o vacío cae a 30 días', () => {
      for (const q of ['periodo=semana', 'periodo=', 'periodo=HOY', 'periodo=toString']) {
        expect(resolver(q).periodo, q).toBe('30d');
      }
    });

    it('repetido cae a 30 días (llega como arreglo)', () => {
      expect(resolver('periodo=hoy&periodo=ayer').periodo).toBe('30d');
    });

    it('todo: sin desde, hasta = hoy', () => {
      const f = resolver('periodo=todo');
      expect([f.periodo, f.desde, f.hasta]).toEqual(['todo', null, '2026-09-23']);
    });

    it('rango: fechas de la URL, invertidas se dan vuelta, 0001-01-01 no pasa', () => {
      const r1 = resolver('periodo=rango&desde=2026-09-10&hasta=2026-09-01');
      expect([r1.periodo, r1.desde, r1.hasta]).toEqual(['rango', '2026-09-01', '2026-09-10']);
      const r2 = resolver('periodo=rango&desde=0001-01-01');
      expect([r2.desde, r2.hasta]).toEqual([null, '2026-09-23']);
    });

    it('rango: el techo es HOY en la zona del comercio elegido, no en la del activo', () => {
      // En Madrid (activo) ya es el 23; en Bogotá (el Café) todavía el 22: el 23 es futuro para él.
      const cafe = resolver('comercio=c-cafe&periodo=rango&desde=2026-09-01&hasta=2026-09-23');
      expect([cafe.desde, cafe.hasta]).toEqual(['2026-09-01', '2026-09-22']);
      const todo = resolver('periodo=rango&desde=2026-09-01&hasta=9999-12-31');
      expect([todo.desde, todo.hasta]).toEqual(['2026-09-01', '2026-09-23']);
    });

    it('desde/hasta sin periodo=rango se ignoran', () => {
      const f = resolver('desde=2026-01-01&hasta=2026-01-31');
      expect([f.periodo, f.desde, f.hasta]).toEqual(['30d', '2026-08-25', '2026-09-23']);
    });
  });

  describe('comercio, sucursal y cajero', () => {
    it('un comercio AJENO cae a "Todo" y arrastra sucursal y cajero', () => {
      const f = resolver(
        'comercio=c-ajeno&sucursal=s-centro&cajero=u-caja',
        contexto({ sucursales: sucursalesCafe, usuarios: usuariosCafe }),
      );
      expect(f.comercio).toBeNull();
      expect(f.sucursal).toBeNull();
      expect(f.cajero).toBeNull();
      expect(f.alcance).toEqual(comercios);
    });

    it('sucursal y cajero del comercio elegido: se aceptan, y se combinan', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-norte&cajero=u-caja',
        contexto({ sucursales: sucursalesCafe, usuarios: usuariosCafe }),
      );
      expect(f.sucursal).toBe(sucursalesCafe[1]);
      expect(f.cajero).toBe(usuariosCafe[1]);
    });

    it('sucursal o cajero que no son de ese comercio: caen a "todas"/"todos" sin tumbar el comercio', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-de-otro&cajero=u-de-otro',
        contexto({ sucursales: sucursalesCafe, usuarios: usuariosCafe }),
      );
      expect(f.comercio).toBe(comercios[0]);
      expect([f.sucursal, f.cajero]).toEqual([null, null]);
    });

    it('sucursal o cajero SIN comercio resuelto: se ignoran (no hay a qué comercio pertenecer)', () => {
      // Aunque el cargador trajera listas: con "Todo" no hay comercio contra el cual validarlas.
      const f = resolver(
        'sucursal=s-centro&cajero=u-caja',
        contexto({ sucursales: sucursalesCafe, usuarios: usuariosCafe }),
      );
      expect(f.comercio).toBeNull();
      expect(f.sucursal).toBeNull();
      expect(f.cajero).toBeNull();
    });

    it('un solo comercio = elegido: sus filtros de sucursal y cajero funcionan sin ?comercio', () => {
      const f = resolver(
        'sucursal=s-centro&cajero=u-dueno',
        contexto({ sucursales: sucursalesCafe, usuarios: usuariosCafe }),
        [comercios[0]],
      );
      expect(f.comercio).toBe(comercios[0]);
      expect(f.sucursal).toBe(sucursalesCafe[0]);
      expect(f.cajero).toBe(usuariosCafe[0]);
      expect(f.zonaHoraria).toBe('America/Bogota');
    });

    it('un id repetido cae, aunque ambos valores fueran válidos', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-centro&sucursal=s-norte',
        contexto({ sucursales: sucursalesCafe }),
      );
      expect(f.comercio).toBe(comercios[0]);
      expect(f.sucursal).toBeNull();
    });
  });

  describe('orden, dirección y página', () => {
    it('cada columna válida, con su dirección inicial si no viene dir', () => {
      expect([resolver('orden=premios').orden, resolver('orden=premios').dir]).toEqual(['premios', 'desc']);
      expect([resolver('orden=ultima').orden, resolver('orden=ultima').dir]).toEqual(['ultima', 'desc']);
      expect([resolver('orden=nombre').orden, resolver('orden=nombre').dir]).toEqual(['nombre', 'asc']);
      expect([resolver('orden=nombre&dir=desc').orden, resolver('orden=nombre&dir=desc').dir]).toEqual([
        'nombre',
        'desc',
      ]);
    });

    it('orden inválido cae a visitas desc; dir inválida cae a la inicial de la columna', () => {
      expect([resolver('orden=telefono&dir=asc').orden, resolver('orden=telefono&dir=asc').dir]).toEqual([
        'visitas',
        'desc',
      ]);
      expect(resolver('orden=nombre&dir=arriba').dir).toBe('asc');
      expect(resolver('orden=premios&dir=ASC').dir).toBe('desc');
    });

    it('acumulado con unidades MEZCLADAS en el alcance cae a visitas desc (también su dir)', () => {
      // "Todo" = Café (puntos) + Spa (sellos).
      const f = resolver('orden=acumulado&dir=asc');
      expect([f.orden, f.dir, f.acumuladoOrdenable]).toEqual(['visitas', 'desc', false]);
    });

    it('acumulado vale si el ALCANCE (no todos los comercios del dueño) tiene una sola unidad', () => {
      // Filtrado al Café, la mezcla con el Spa ya no existe.
      const f = resolver('comercio=c-cafe&orden=acumulado', contexto({ sucursales: sucursalesCafe }));
      expect([f.orden, f.dir, f.acumuladoOrdenable]).toEqual(['acumulado', 'desc', true]);
    });

    it('acumulado cae a visitas si el único tipo no tiene contador', () => {
      const ctx = contexto({
        datosComercios: [{ comercioId: 'c-cafe', zonaHoraria: 'America/Bogota', tipoPrincipal: 'cupon' }],
      });
      const f = resolver('orden=acumulado', ctx, [comercios[0]]);
      expect([f.orden, f.acumuladoOrdenable]).toEqual(['visitas', false]);
    });

    it('un comercio del alcance sin datos en el contexto: no se ordena por acumulado y la zona es la activa', () => {
      // Un cargador que se olvidó de un comercio no debe producir un orden que mezcle unidades.
      const ctx = contexto({ datosComercios: [] });
      const f = resolver('comercio=c-cafe&orden=acumulado&periodo=hoy', ctx);
      expect([f.orden, f.acumuladoOrdenable]).toEqual(['visitas', false]);
      expect(f.zonaHoraria).toBe('Europe/Madrid');
    });

    it('página: entero de 1 a 10 000; cualquier otra cosa es 1', () => {
      expect(resolver('pagina=3').pagina).toBe(3);
      expect(resolver('pagina=10000').pagina).toBe(10000);
      for (const q of ['pagina=0', 'pagina=-2', 'pagina=10001', 'pagina=2.5', 'pagina=abc', 'pagina=1e3', 'pagina=', 'pagina=3&pagina=4']) {
        expect(resolver(q).pagina, q).toBe(1);
      }
    });
  });
});
