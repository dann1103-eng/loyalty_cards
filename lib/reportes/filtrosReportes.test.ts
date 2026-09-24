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
// para poder mutarla: la PÁGINA no se prueba (el repo no tiene pruebas de componentes), y la prueba
// de la ruta del Excel (Tarea 5) mockea el gate; las reglas se fijan acá, una vez, para las dos.
//
// MUTATION-TESTING (corridas el 2026-09-23, con el mensaje que se vio caer):
// - El `=== 1` de comercioAConsultar (→ `=== 0`): caen "con UN solo comercio, es ese aunque la URL
//   no lo traiga" y "un solo comercio = elegido: sus filtros de sucursal y cajero funcionan sin
//   ?comercio", las dos con `expected null to be { Object (comercioId, nombre) }`.
// - Listas aceptadas sin comercio resuelto ni etiqueta (`listasDelComercio = true`): caen cuatro,
//   "un comercio AJENO cae a Todo…", "sucursal o cajero SIN comercio resuelto…", "listas de OTRO
//   comercio…" y "listas sin comercio declarado…", con `expected { id: 's-centro', nombre: 'Centro' }
//   to be null`. (En la primera ronda, con el `comercio ?` de antes, caían las dos primeras con ese
//   mensaje, y con el cajero `expected { id: 'u-caja', email: 'caja@cafe.sv' } to be null`.)
// - Sin comparar comercioDeLasListas con el resuelto (`listasDelComercio = comercio !== null`): caen
//   "listas de OTRO comercio se tratan como vacías" y "listas sin comercio declarado (null) también",
//   con `expected { id: 's-centro', nombre: 'Centro' } to be null`.
// - Zona siempre la del activo (`const zonaHoraria = zonaActiva`): caen cuatro, entre ellas "con un
//   comercio elegido, los presets se resuelven en SU zona" con `expected 'Europe/Madrid' to be
//   'America/Bogota'`, "el comercio con zona válida gana aunque la del activo sea ilegible" con
//   `expected 'America/El_Salvador' to be 'America/Bogota'` y "rango: el techo es HOY en la zona del
//   comercio elegido" con `expected [ '2026-09-01', '2026-09-23' ] to deeply equal [ '2026-09-01',
//   '2026-09-22' ]`.
// - La zona del comercio sin validar (`datos?.zonaHoraria || zonaActiva`, lo de antes: solo la vacía
//   caía): cae "el comercio elegido con una zona que no existe cae a la del ACTIVO" con `RangeError:
//   Invalid time zone specified: Marte/Olympus`.
// - La zona del activo sin validar (`const zonaActiva = true ? contexto.zonaComercioActivo : …`):
//   caen "activo vacío y comercio sin datos…" con `expected '' to be 'America/El_Salvador'` (hoyEnZona
//   no lanza con '', pero la zona que se le pasaría al Excel sí) y "Todo con el activo inválido" con
//   `RangeError: Invalid time zone specified: Marte/Olympus`.
// - datosAlcance con TODOS los comercios del dueño en vez del alcance: cae "solo los del alcance…" con
//   `expected Map{ 'c-cafe' => { …(2) }, …(1) } to deeply equal Map{ 'c-spa' => { …(2) } }`.
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
    comercioDeLasListas: null,
    sucursales: [],
    usuarios: [],
    ...extra,
  };
}

// Lo que el cargador trae cuando el comercio a consultar es el Café: sus sucursales y usuarios,
// etiquetados con de qué comercio son.
const LISTAS_CAFE = { comercioDeLasListas: 'c-cafe', sucursales: sucursalesCafe, usuarios: usuariosCafe };

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
      datosAlcance: new Map([
        ['c-cafe', { zonaHoraria: 'America/Bogota', tipoPrincipal: 'puntos' }],
        ['c-spa', { zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'sellos' }],
      ]),
    });
  });

  it('con un comercio elegido, los presets se resuelven en SU zona', () => {
    const f = resolver('comercio=c-cafe&periodo=hoy', contexto(LISTAS_CAFE));
    expect(f.comercio).toBe(comercios[0]);
    expect(f.alcance).toEqual([comercios[0]]);
    expect(f.zonaHoraria).toBe('America/Bogota');
    expect([f.desde, f.hasta]).toEqual(['2026-09-22', '2026-09-22']); // Bogotá: todavía el 22
  });

  // Una zona ilegible NO puede tumbar la página: Intl lanza RangeError con una zona que no conoce, y
  // la pantalla daría 500 si la consulta de zona del cargador fallara y alguien escribiera `?? ''`.
  // El respaldo es en cascada: la del comercio elegido si es válida; si no, la del activo si es
  // válida; si no, ZONA_HORARIA_DEFAULT (America/El_Salvador). "Válida" = de la lista cerrada de
  // zonasHorarias.ts, la misma que respalda el CHECK de la 0015.
  describe('zona horaria inválida', () => {
    const conZonaCafe = (zona: string) =>
      contexto({
        datosComercios: [
          { comercioId: 'c-cafe', zonaHoraria: zona, tipoPrincipal: 'puntos' },
          { comercioId: 'c-spa', zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'sellos' },
        ],
      });

    it('el comercio elegido con una zona que no existe cae a la del ACTIVO', () => {
      const f = resolver('comercio=c-cafe&periodo=hoy', conZonaCafe('Marte/Olympus'));
      expect(f.zonaHoraria).toBe('Europe/Madrid');
      expect([f.desde, f.hasta]).toEqual(['2026-09-23', '2026-09-23']);
      expect(f.datosAlcance.get('c-cafe')?.zonaHoraria).toBe('Europe/Madrid');
    });

    it('una zona VACÍA del comercio cae igual que una inválida (mismo respaldo, no otro)', () => {
      expect(resolver('comercio=c-cafe', conZonaCafe('')).zonaHoraria).toBe('Europe/Madrid');
    });

    it('activo vacío y comercio sin datos: America/El_Salvador, sin lanzar', () => {
      const f = resolver('comercio=c-cafe&periodo=hoy', contexto({ zonaComercioActivo: '', datosComercios: [] }));
      expect(f.zonaHoraria).toBe('America/El_Salvador');
      expect([f.desde, f.hasta]).toEqual(['2026-09-22', '2026-09-22']); // 21:00 del 22 en El Salvador
    });

    it('"Todo" con el activo inválido: America/El_Salvador', () => {
      const f = resolver('periodo=hoy', contexto({ zonaComercioActivo: 'Marte/Olympus' }));
      expect(f.zonaHoraria).toBe('America/El_Salvador');
      // Y los comercios del alcance conservan SU zona válida: el respaldo es por comercio.
      expect(f.datosAlcance.get('c-cafe')?.zonaHoraria).toBe('America/Bogota');
    });

    it('el comercio con zona válida gana aunque la del activo sea ilegible', () => {
      const f = resolver('comercio=c-cafe', contexto({ zonaComercioActivo: 'Marte/Olympus' }));
      expect(f.zonaHoraria).toBe('America/Bogota');
    });
  });

  describe('datosAlcance: zona y tipo RESUELTOS de cada comercio del alcance', () => {
    it('solo los del alcance: con un comercio elegido, solo ese', () => {
      const f = resolver('comercio=c-spa');
      expect(f.datosAlcance).toEqual(
        new Map([['c-spa', { zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'sellos' }]]),
      );
    });

    it('un comercio sin datos en el contexto: zona del activo y tipo puntos (la degradación de tipoOPuntos)', () => {
      const f = resolver('', contexto({ datosComercios: [] }));
      expect(f.datosAlcance).toEqual(
        new Map([
          ['c-cafe', { zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'puntos' }],
          ['c-spa', { zonaHoraria: 'Europe/Madrid', tipoPrincipal: 'puntos' }],
        ]),
      );
    });
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
        contexto(LISTAS_CAFE),
      );
      expect(f.comercio).toBeNull();
      expect(f.sucursal).toBeNull();
      expect(f.cajero).toBeNull();
      expect(f.alcance).toEqual(comercios);
    });

    it('sucursal y cajero del comercio elegido: se aceptan, y se combinan', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-norte&cajero=u-caja',
        contexto(LISTAS_CAFE),
      );
      expect(f.sucursal).toBe(sucursalesCafe[1]);
      expect(f.cajero).toBe(usuariosCafe[1]);
    });

    it('sucursal o cajero que no son de ese comercio: caen a "todas"/"todos" sin tumbar el comercio', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-de-otro&cajero=u-de-otro',
        contexto(LISTAS_CAFE),
      );
      expect(f.comercio).toBe(comercios[0]);
      expect([f.sucursal, f.cajero]).toEqual([null, null]);
    });

    it('sucursal o cajero SIN comercio resuelto: se ignoran (no hay a qué comercio pertenecer)', () => {
      // Aunque el cargador trajera listas: con "Todo" no hay comercio contra el cual validarlas.
      const f = resolver(
        'sucursal=s-centro&cajero=u-caja',
        contexto(LISTAS_CAFE),
      );
      expect(f.comercio).toBeNull();
      expect(f.sucursal).toBeNull();
      expect(f.cajero).toBeNull();
    });

    it('un solo comercio = elegido: sus filtros de sucursal y cajero funcionan sin ?comercio', () => {
      const f = resolver(
        'sucursal=s-centro&cajero=u-dueno',
        contexto(LISTAS_CAFE),
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
        contexto(LISTAS_CAFE),
      );
      expect(f.comercio).toBe(comercios[0]);
      expect(f.sucursal).toBeNull();
    });

    // Defensa en profundidad del contrato con el cargador: las listas tienen que ser del comercio
    // RESUELTO. Si un cargador las trajera de otro (el activo del switcher, por ejemplo), un id de
    // sucursal de ESE otro comercio validaría acá y llegaría a la RPC del comercio elegido.
    it('listas de OTRO comercio se tratan como vacías', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-centro&cajero=u-caja',
        contexto({ ...LISTAS_CAFE, comercioDeLasListas: 'c-spa' }),
      );
      expect(f.comercio).toBe(comercios[0]);
      expect(f.sucursal).toBeNull();
      expect(f.cajero).toBeNull();
    });

    it('listas sin comercio declarado (null) también', () => {
      const f = resolver(
        'comercio=c-cafe&sucursal=s-centro&cajero=u-caja',
        contexto({ ...LISTAS_CAFE, comercioDeLasListas: null }),
      );
      expect(f.sucursal).toBeNull();
      expect(f.cajero).toBeNull();
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
      const f = resolver('comercio=c-cafe&orden=acumulado', contexto(LISTAS_CAFE));
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
