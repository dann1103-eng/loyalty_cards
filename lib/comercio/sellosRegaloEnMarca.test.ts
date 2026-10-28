import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { guardarBranding, type DatosBranding } from './guardarBranding';
import {
  guardarBrandingPrograma,
  brandingDeProgramas,
  brandingProgramaDesdeFormulario,
  type DatosBrandingPrograma,
} from './guardarBrandingPrograma';
import { obtenerPrograma } from './programas';
import { eliminarComercio } from '../comercios/guardarComercio';

// Los sellos de regalo (0043) en el camino de Marca: la parte que se puede probar SIN base de datos.
// Plan: docs/superpowers/plans/2026-10-28-sellos-de-regalo.md, sección 3.3.
//
// Hay un cliente FALSO que solo anota qué se le pidió a cada tabla. Ojo con lo que NO prueba: no sabe
// si la columna existe ni si el CHECK cruzado deja pasar el par (eso lo prueban guardarBranding.test.ts,
// guardarBrandingPrograma.test.ts y guardarComercio.test.ts contra la base real, y necesitan la 0043
// aplicada). Lo que sí fija acá, y por eso vive en un archivo aparte que corre sin .env.local:
//
//   - el regalo se valida ANTES de escribir nada. Con un cliente que anota cada llamada, "la fila queda
//     SIN tocar" deja de ser una inferencia desde la base y es una aserción directa: cero llamadas;
//   - el orden de los errores: el de la meta se lee antes que el del regalo;
//   - `sellos_regalo` viaja en el MISMO update que `sello_meta` (el CHECK compara las dos columnas
//     nuevas juntas), y un regalo 0 SE ESCRIBE: es la forma en que el dueño borra el que puso;
//   - la lectura pide la columna (un select sin ella devuelve undefined y el regalo se reposita o se
//     precarga como 0 sin ningún error).
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida y restaurada:
//   - guardarBranding: sacar `sellos_regalo` del update del programa hace fallar "escribe sello_meta y
//     sellos_regalo en el MISMO update" (falta la clave en el payload).
//   - guardarBranding: escribirlo en un SEGUNDO update posterior hace fallar la misma prueba (dos
//     updates al programa en vez de uno).
//   - guardarBranding: `sellos_regalo: datos.sellos_regalo || undefined` (el 0 se omite) hace fallar
//     "un regalo 0 SE ESCRIBE".
//   - guardarBranding: sacar la llamada a validarSellosRegalo hace fallar las pruebas del mensaje exacto
//     (el guardado sigue de largo y escribe).
//   - guardarBranding: mover la validación DESPUÉS del update de comercios hace fallar "no toca la base":
//     queda una llamada a comercios.
//   - guardarBranding: validar el regalo ANTES de la meta hace fallar "con la meta inválida lee primero
//     el error de la meta" (sale el mensaje del regalo).
//   - las mismas seis sobre guardarBrandingPrograma.
//   - brandingProgramaDesdeFormulario: `sellosRegalo: 0` fijo hace fallar la prueba del pase directo.
//   - brandingDeProgramas / obtenerPrograma: sacar `sellos_regalo` del select, o `sellosRegalo` del
//     mapeo, hace fallar las pruebas de lectura.
//   - eliminarComercio: sacar `sellos_regalo` del select de la principal, o del insert que la repone,
//     hace fallar las pruebas del rollback.

interface Llamada {
  tabla: string;
  operacion: 'select' | 'insert' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  columnas?: string;
}
type Respuesta = { data: unknown; error: { code?: string; message?: string } | null };

// Un cliente de Supabase que contesta lo que le diga `responder` y anota cada `from()`. Encadenable y
// esperable (thenable), como el real: `await supabase.from(t).update(p).eq(a, b)` y `.single()` andan.
// La operación es la PRIMERA que se pide: en `from(t).update(p).select(c)` el select no la cambia.
function clienteFalso(responder: (llamada: Llamada) => Respuesta = () => ({ data: null, error: null })) {
  const llamadas: Llamada[] = [];
  const cliente = {
    from(tabla: string) {
      const llamada: Llamada = { tabla, operacion: 'select' };
      llamadas.push(llamada);
      let iniciada = false;
      const iniciar = (operacion: Llamada['operacion'], payload?: Record<string, unknown>) => {
        iniciada = true;
        llamada.operacion = operacion;
        llamada.payload = payload;
        return cadena;
      };
      const cadena = {
        select(columnas?: string) {
          if (!iniciada) {
            iniciada = true;
            llamada.operacion = 'select';
            llamada.columnas = columnas;
          }
          return cadena;
        },
        insert: (payload: Record<string, unknown>) => iniciar('insert', payload),
        update: (payload: Record<string, unknown>) => iniciar('update', payload),
        delete: () => iniciar('delete'),
        eq: () => cadena,
        order: () => cadena,
        single: async () => responder(llamada),
        maybeSingle: async () => responder(llamada),
        then: (alResolver: (r: Respuesta) => unknown, alRechazar?: (e: unknown) => unknown) =>
          Promise.resolve(responder(llamada)).then(alResolver, alRechazar),
      };
      return cadena;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, llamadas };
}

const escrituras = (llamadas: Llamada[]) => llamadas.filter((l) => l.operacion !== 'select');

const MENSAJE_REGALO_IGUAL_A_META =
  'Los sellos de regalo tienen que ser menos que la meta (10): si no, la tarjeta nacería completa.';
const MENSAJE_REGALO_SIN_META = 'Poné la meta de sellos antes de regalar sellos.';
const MENSAJE_META_INVALIDA = 'La meta de sellos debe ser un número entero mayor que cero.';
const MENSAJE_REGALO_NO_ENTERO = 'Los sellos de regalo tienen que ser un número entero, 0 o más.';

describe('guardarBranding: el regalo', () => {
  const DATOS: DatosBranding = {
    color_fondo: 'rgb(10, 20, 30)',
    color_texto: 'rgb(255, 255, 255)',
    color_label: 'rgb(200, 200, 200)',
    sello_meta: 10,
    sellos_regalo: 2,
    difuminado_franja: 'medio',
    nombre_pase: null,
    encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
    oscurecer_franja: true,
  };

  it('escribe sello_meta y sellos_regalo en el MISMO update del programa principal', async () => {
    const { cliente, llamadas } = clienteFalso();

    const res = await guardarBranding(cliente, 'comercio-1', DATOS);

    expect(res).toEqual({ ok: true });
    // UN update al programa, no dos: el CHECK cruzado de la 0043 compara las dos columnas nuevas
    // juntas, y en dos sentencias el orden decidiría si un cambio de meta y regalo pasa.
    const alPrograma = llamadas.filter((l) => l.tabla === 'programas_tarjeta' && l.operacion === 'update');
    expect(alPrograma, 'un solo update al programa').toHaveLength(1);
    expect(alPrograma[0].payload).toMatchObject({ sello_meta: 10, sellos_regalo: 2 });
  });

  it('un regalo 0 SE ESCRIBE: es la forma en que el dueño borra el que había puesto', async () => {
    const { cliente, llamadas } = clienteFalso();

    await guardarBranding(cliente, 'comercio-1', { ...DATOS, sellos_regalo: 0 });

    const alPrograma = llamadas.find((l) => l.tabla === 'programas_tarjeta' && l.operacion === 'update')!;
    // toHaveProperty con el valor, no `toBeDefined`: un `0 || undefined` deja la CLAVE pero con
    // undefined, y al serializar la clave desaparece y la columna queda con el regalo anterior.
    expect(alPrograma.payload).toHaveProperty('sellos_regalo', 0);
  });

  it('un regalo igual a la meta se rechaza con el mensaje exacto y no toca la base', async () => {
    const { cliente, llamadas } = clienteFalso();

    const res = await guardarBranding(cliente, 'comercio-1', { ...DATOS, sellos_regalo: 10 });

    expect(res).toEqual({ ok: false, error: MENSAJE_REGALO_IGUAL_A_META });
    // Ni comercios ni programas: la validación va antes del PRIMER write. Si fuera después del update
    // de comercios, los colores nuevos quedarían guardados con un error en pantalla.
    expect(llamadas, 'no se le pidió nada a ninguna tabla').toEqual([]);
  });

  it('un regalo con la meta vacía se rechaza con el mensaje exacto y no toca la base', async () => {
    const { cliente, llamadas } = clienteFalso();

    const res = await guardarBranding(cliente, 'comercio-1', { ...DATOS, sello_meta: null, sellos_regalo: 2 });

    expect(res).toEqual({ ok: false, error: MENSAJE_REGALO_SIN_META });
    expect(llamadas).toEqual([]);
  });

  it('un regalo con basura (NaN) se rechaza con el mensaje del entero, no se cuela como 2', async () => {
    const { cliente, llamadas } = clienteFalso();

    const res = await guardarBranding(cliente, 'comercio-1', { ...DATOS, sellos_regalo: Number('2a') });

    expect(res).toEqual({ ok: false, error: MENSAJE_REGALO_NO_ENTERO });
    expect(llamadas).toEqual([]);
  });

  it('con la meta inválida lee primero el error de la meta, no el del regalo', async () => {
    const { cliente, llamadas } = clienteFalso();

    // Meta 0 con regalo 2: si el regalo se validara primero, "2 es mayor o igual a la meta (0)" le
    // hablaría al dueño de un número que no es el que está mal.
    const res = await guardarBranding(cliente, 'comercio-1', { ...DATOS, sello_meta: 0, sellos_regalo: 2 });

    expect(res).toEqual({ ok: false, error: MENSAJE_META_INVALIDA });
    expect(llamadas).toEqual([]);
  });
});

describe('guardarBrandingPrograma: el regalo', () => {
  const DATOS: DatosBrandingPrograma = {
    brandingPropio: false,
    colorFondo: null,
    colorTexto: null,
    colorLabel: null,
    difuminadoFranja: null,
    encuadreFranja: null,
    oscurecerFranja: null,
    selloMeta: 10,
    sellosRegalo: 2,
    nombrePase: null,
  };
  // El update de la tarjeta termina en .select().single() y guardarBrandingPrograma lee de la fila.
  const FILA_ESCRITA = { branding_propio: false, color_fondo: null, logo_url: null, hero_url: null };
  const responder = (): Respuesta => ({ data: FILA_ESCRITA, error: null });

  it('escribe sello_meta y sellos_regalo en el MISMO update', async () => {
    const { cliente, llamadas } = clienteFalso(responder);

    const res = await guardarBrandingPrograma(cliente, 'comercio-1', 'programa-1', DATOS);

    expect(res.ok).toBe(true);
    const updates = escrituras(llamadas);
    expect(updates, 'un solo write: el update del programa').toHaveLength(1);
    expect(updates[0].tabla).toBe('programas_tarjeta');
    expect(updates[0].payload).toMatchObject({ sello_meta: 10, sellos_regalo: 2 });
  });

  it('un regalo 0 SE ESCRIBE: es la forma en que el dueño borra el que había puesto', async () => {
    const { cliente, llamadas } = clienteFalso(responder);

    await guardarBrandingPrograma(cliente, 'comercio-1', 'programa-1', { ...DATOS, sellosRegalo: 0 });

    expect(escrituras(llamadas)[0].payload).toHaveProperty('sellos_regalo', 0);
  });

  it('un regalo igual a la meta se rechaza con el mensaje exacto y no toca la base', async () => {
    const { cliente, llamadas } = clienteFalso(responder);

    const res = await guardarBrandingPrograma(cliente, 'comercio-1', 'programa-1', { ...DATOS, sellosRegalo: 10 });

    expect(res).toEqual({ ok: false, error: MENSAJE_REGALO_IGUAL_A_META });
    expect(llamadas, 'no se le pidió nada a ninguna tabla').toEqual([]);
  });

  it('un regalo con la meta vacía se rechaza con el mensaje exacto y no toca la base', async () => {
    const { cliente, llamadas } = clienteFalso(responder);

    const res = await guardarBrandingPrograma(cliente, 'comercio-1', 'programa-1', {
      ...DATOS,
      selloMeta: null,
      sellosRegalo: 2,
    });

    expect(res).toEqual({ ok: false, error: MENSAJE_REGALO_SIN_META });
    expect(llamadas).toEqual([]);
  });

  it('un regalo con basura (NaN) se rechaza con el mensaje del entero', async () => {
    const { cliente, llamadas } = clienteFalso(responder);

    const res = await guardarBrandingPrograma(cliente, 'comercio-1', 'programa-1', {
      ...DATOS,
      sellosRegalo: Number('2a'),
    });

    expect(res).toEqual({ ok: false, error: MENSAJE_REGALO_NO_ENTERO });
    expect(llamadas).toEqual([]);
  });

  it('con la meta inválida lee primero el error de la meta, no el del regalo', async () => {
    const { cliente, llamadas } = clienteFalso(responder);

    const res = await guardarBrandingPrograma(cliente, 'comercio-1', 'programa-1', {
      ...DATOS,
      selloMeta: 0,
      sellosRegalo: 2,
    });

    expect(res).toEqual({ ok: false, error: MENSAJE_META_INVALIDA });
    expect(llamadas).toEqual([]);
  });
});

describe('brandingProgramaDesdeFormulario: el regalo', () => {
  const base = {
    brandingPropio: false,
    colorFondo: '',
    colorTexto: '',
    colorLabel: '',
    difuminadoFranja: '',
    encuadre: { modo: '', focoX: '', focoY: '', zoom: '' },
    oscurecerFranja: '',
    selloMeta: '10',
    nombrePase: '',
  };

  it('pasa el regalo tal cual, sin tocarlo', () => {
    expect(brandingProgramaDesdeFormulario({ ...base, sellosRegalo: 3 }).sellosRegalo).toBe(3);
  });

  it('un NaN llega como NaN: lo rechaza la validación, no se vuelve 0 en silencio', () => {
    // Un 0 inventado acá guardaría "sin regalo" cuando el dueño escribió algo ilegible.
    expect(Number.isNaN(brandingProgramaDesdeFormulario({ ...base, sellosRegalo: Number('2a') }).sellosRegalo)).toBe(true);
  });
});

describe('lectura: el regalo vuelve como sellosRegalo y la columna se pide', () => {
  it('brandingDeProgramas pide sellos_regalo y lo devuelve en cada fila', async () => {
    const fila = {
      id: 'programa-1',
      branding_propio: false,
      color_fondo: null,
      color_texto: null,
      color_label: null,
      logo_url: null,
      hero_url: null,
      strip_url: null,
      sello_icono_url: null,
      sello_icono_2_url: null,
      sello_patron: null,
      sello_casillas: null,
      difuminado_franja: null,
      encuadre_franja: null,
      oscurecer_franja: null,
      foco_franja_x: null,
      foco_franja_y: null,
      zoom_franja: null,
      sello_meta: 10,
      sellos_regalo: 2,
      nombre_pase: null,
    };
    const { cliente, llamadas } = clienteFalso(() => ({ data: [fila], error: null }));

    const filas = await brandingDeProgramas(cliente, 'comercio-1');

    expect(filas).toHaveLength(1);
    expect(filas[0].sellosRegalo).toBe(2);
    // El select de verdad es lo único que decide qué trae la base: con la columna afuera llegaría
    // undefined y la pantalla precargaría "0" sin ningún error.
    expect(llamadas[0].columnas).toMatch(/\bsellos_regalo\b/);
  });

  it('obtenerPrograma pide sellos_regalo y lo devuelve como sellosRegalo', async () => {
    const fila = {
      id: 'programa-1',
      nombre: 'Principal',
      slug: 'principal',
      tipo_tarjeta: 'sellos',
      es_principal: true,
      activo: true,
      sello_meta: 10,
      sellos_regalo: 2,
      nombre_pase: null,
      cashback_porcentaje: null,
      multipass_visitas: null,
      membresia_dias: null,
      cupon_vigencia_dias: null,
      aviso_vencimiento_activo: false,
      aviso_vencimiento_dias: null,
      aviso_vencimiento_mensaje: null,
    };
    const { cliente, llamadas } = clienteFalso(() => ({ data: fila, error: null }));

    const programa = await obtenerPrograma(cliente, 'comercio-1', 'programa-1');

    expect(programa?.sellosRegalo).toBe(2);
    expect(llamadas[0].columnas).toMatch(/\bsellos_regalo\b/);
  });
});

describe('eliminarComercio: el rollback repone el regalo', () => {
  it('un borrado rechazado vuelve a insertar la principal con su meta Y sus sellos de regalo', async () => {
    const principal = {
      id: 'programa-1',
      nombre: 'Principal',
      slug: 'principal',
      tipo_tarjeta: 'sellos',
      activo: true,
      sello_meta: 10,
      sellos_regalo: 2,
      cashback_porcentaje: null,
      multipass_visitas: null,
      membresia_dias: null,
      cupon_vigencia_dias: null,
      created_at: '2026-01-01T00:00:00+00:00',
    };
    const sucursal = { id: 'sucursal-1', nombre: 'Principal', activa: true, created_at: '2026-01-01T00:00:00+00:00' };
    const { cliente, llamadas } = clienteFalso((l) => {
      if (l.tabla === 'sucursales' && l.operacion === 'select') return { data: sucursal, error: null };
      if (l.tabla === 'programas_tarjeta' && l.operacion === 'select') return { data: principal, error: null };
      // El borrado del comercio es lo que falla (acá, por una FK): ahí la principal tiene que volver.
      if (l.tabla === 'comercios' && l.operacion === 'delete') {
        return { data: null, error: { code: '23503', message: 'viola la llave foránea' } };
      }
      return { data: null, error: null };
    });

    const res = await eliminarComercio(cliente, 'comercio-1');

    expect(res.ok).toBe(false);
    const lecturaDePrincipal = llamadas.find((l) => l.tabla === 'programas_tarjeta' && l.operacion === 'select')!;
    // Si el select no la pide, la base devuelve la fila SIN la columna y el insert de abajo la omite:
    // el regalo vuelve al default 0 sin un solo error.
    expect(lecturaDePrincipal.columnas).toMatch(/\bsellos_regalo\b/);
    const reposicion = llamadas.find((l) => l.tabla === 'programas_tarjeta' && l.operacion === 'insert')!;
    expect(reposicion, 'el programa principal se volvió a insertar').toBeDefined();
    expect(reposicion.payload).toMatchObject({ id: 'programa-1', sello_meta: 10, sellos_regalo: 2 });
  });
});
