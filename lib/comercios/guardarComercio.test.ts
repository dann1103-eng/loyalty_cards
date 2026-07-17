import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearComercio, actualizarComercio, type DatosComercio } from './guardarComercio';

const supabase = createServiceClient();
const slugsDePrueba: string[] = [];

afterEach(async () => {
  if (!slugsDePrueba.length) return;
  const { error } = await supabase.from('comercios').delete().in('slug', slugsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  slugsDePrueba.length = 0;
});

function datosValidos(slug: string): DatosComercio {
  slugsDePrueba.push(slug);
  return {
    nombre: 'Comercio Test',
    slug,
    color_fondo: 'rgb(35, 24, 18)',
    color_texto: 'rgb(255, 255, 255)',
    color_label: 'rgb(255, 255, 255)',
    logo_url: null,
    strip_url: null,
    hero_url: null,
    licencia_estado: 'activo',
    licencia_plan: 'Básico',
    licencia_monto_mensual: 25,
    licencia_activa_desde: '2026-07-16',
  };
}

describe('crearComercio', () => {
  it('crea un comercio con licencia y branding', async () => {
    const slug = `test-crear-${Date.now()}`;
    const res = await crearComercio(supabase, datosValidos(slug));

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
      .eq('slug', slug)
      .single();
    expect(data!.nombre).toBe('Comercio Test');
    expect(data!.licencia_estado).toBe('activo');
    // Sin Number(): PostgREST devuelve numeric como número JSON. Aserción más fuerte —
    // fallaría ruidosamente si eso cambiara, en vez de que Number() lo tapara en silencio.
    expect(data!.licencia_monto_mensual).toBe(25);
    // Fija la migración 0004: la columna es `date`, no timestamptz, y PostgREST la devuelve
    // como "2026-07-16" tal cual. Si alguien la revierte a timestamptz, esto falla — que es el
    // punto: con timestamptz, El Salvador (UTC-6) renderizaría el 15 de julio en cada fila.
    expect(data!.licencia_activa_desde).toBe('2026-07-16');
  });

  it('rechaza un slug duplicado con un mensaje claro, sin lanzar', async () => {
    const slug = `test-dup-${Date.now()}`;
    await crearComercio(supabase, datosValidos(slug));

    const res = await crearComercio(supabase, { ...datosValidos(slug), nombre: 'Otro' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/slug/i);
  });

  it('rechaza un color con formato inválido', async () => {
    const slug = `test-color-${Date.now()}`;
    const res = await crearComercio(supabase, { ...datosValidos(slug), color_fondo: '#231812' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('rechaza un monto mensual negativo', async () => {
    const slug = `test-monto-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...datosValidos(slug),
      licencia_monto_mensual: -50,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza un estado de licencia que la BD no acepta', async () => {
    const slug = `test-estado-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...datosValidos(slug),
      licencia_estado: 'suspendido',
    });

    expect(res.ok).toBe(false);
    // Debe explicar QUÉ está mal. Sin la validación, esto igual daría ok:false — pero por un
    // 23514 traducido a "No se pudo crear el comercio", que no le dice nada a nadie.
    if (!res.ok) expect(res.error).toMatch(/estado/i);
  });

  it('rechaza un nombre vacío', async () => {
    const slug = `test-nombre-${Date.now()}`;
    const res = await crearComercio(supabase, { ...datosValidos(slug), nombre: '   ' });

    expect(res.ok).toBe(false);
    // La BD acepta nombre:'' sin chistar (no hay CHECK) — validar() es la única defensa.
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('rechaza slugs con formato inválido', async () => {
    // El slug es la URL del QR impreso, así que su forma no es cosmética.
    for (const malo of ['Test-Mayusculas', 'con espacios', 'acentué', '']) {
      // Registrar el slug que REALMENTE se inserta: el spread de abajo pisa el de datosValidos(),
      // así que sin esta línea afterEach borraría un slug que nunca existió. No muerde con el
      // código correcto (validar() rechaza los cuatro antes de insertar), pero sí cada vez que
      // se muta la regla del slug — y 'Test-Mayusculas' ni siquiera calza un barrido test-%.
      slugsDePrueba.push(malo);
      const res = await crearComercio(supabase, { ...datosValidos(`test-slug-${Date.now()}`), slug: malo });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/slug/i);
    }
  });

  it('valida los tres colores, no solo el de fondo', async () => {
    // Sin esto, una sola prueba sobre color_fondo da la impresión de que los colores están
    // cubiertos, y dos tercios de ellos no lo están. Cada uno revienta al firmar el pass.
    for (const campo of ['color_texto', 'color_label'] as const) {
      // El slug NO puede llevar el guion bajo de `campo`: la regex de slug lo rechaza y validar()
      // corta ahí, antes de llegar a los colores — la prueba fallaría por el slug, sin ejercitar
      // nunca lo que dice probar.
      const res = await crearComercio(supabase, {
        ...datosValidos(`test-${campo.replace('_', '-')}-${Date.now()}`),
        [campo]: '#231812',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/color/i);
    }
  });

  it('rechaza un monto que no es un número', async () => {
    const slug = `test-nan-${Date.now()}`;
    // La Tarea 9 hace Number(monto): un "25a" en el formulario llega como NaN. Sin el
    // Number.isFinite, JSON.stringify(NaN) es "null" y el monto se guardaría VACÍO en silencio.
    const res = await crearComercio(supabase, { ...datosValidos(slug), licencia_monto_mensual: NaN });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monto/i);
  });

  it('rechaza fechas inválidas o con el formato equivocado', async () => {
    // '16/07/2026' es lo que teclea alguien en El Salvador; '2026-02-31' tiene forma correcta
    // pero no existe. Las dos deben explicar qué pasa, no dar un error genérico.
    // '0000-01-01' pasa el round-trip de Date (JS representa el año 0 y lo devuelve igual) pero
    // Postgres lo rechaza con un 22008: no existe el año cero. Sin el (?!0000) sale el genérico.
    for (const mala of ['16/07/2026', 'ayer', '2026-02-31', '2026-7-6', '0000-01-01']) {
      const res = await crearComercio(supabase, {
        ...datosValidos(`test-fecha-${Date.now()}`),
        licencia_activa_desde: mala,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/fecha/i);
    }
  });

  it('normaliza espacios y guarda los opcionales vacíos como null', async () => {
    const slug = `test-normalizar-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...datosValidos(slug),
      nombre: '  Café con Espacios  ',
      color_fondo: '  rgb(35, 24, 18)  ',
      licencia_estado: '  activo  ',
      logo_url: '',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, color_fondo, licencia_estado, logo_url')
      .eq('slug', slug)
      .single();
    expect(data!.nombre).toBe('Café con Espacios');
    // licencia_estado es el único string que normalizar() podría olvidar trimear, y sin trim
    // '  activo  ' se rechaza con un mensaje que se ve idéntico a lo que el admin escribió.
    expect(data!.licencia_estado).toBe('activo');
    // validarColorRgb hace su propio .trim() interno, así que sin normalizar ANTES del insert
    // este valor pasaría la validación y se guardaría con los espacios intactos.
    expect(data!.color_fondo).toBe('rgb(35, 24, 18)');
    // El formulario HTML de la Tarea 9 manda '' (nunca null) para un campo opcional vacío.
    expect(data!.logo_url).toBeNull();
  });
});

describe('actualizarComercio', () => {
  it('actualiza licencia y branding de un comercio existente', async () => {
    const slug = `test-editar-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, {
      ...datosValidos(slug),
      nombre: 'Nombre Editado',
      licencia_estado: 'inactivo',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, licencia_estado')
      .eq('id', creado.id)
      .single();
    expect(data!.nombre).toBe('Nombre Editado');
    expect(data!.licencia_estado).toBe('inactivo');
  });

  it('valida igual que crearComercio', async () => {
    // Esta es LA prueba que faltaba: borrar validar() de actualizarComercio dejaba las 7 pruebas
    // en verde, y guardaba color_fondo:'no-es-un-color' con ok:true — datos que revientan al
    // firmar el pass, en producción, sin que nada los atrape (la BD no respalda esta regla).
    const slug = `test-editar-invalido-${Date.now()}`;
    const creado = await crearComercio(supabase, datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, {
      ...datosValidos(slug),
      color_fondo: 'no-es-un-color',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('falla si el comercio ya no existe, en vez de reportar éxito', async () => {
    // Sin el .select('id').single(), esto devolvía ok:true habiendo escrito cero filas.
    const res = await actualizarComercio(
      supabase,
      '00000000-0000-0000-0000-000000000000',
      datosValidos(`test-fantasma-${Date.now()}`),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});
