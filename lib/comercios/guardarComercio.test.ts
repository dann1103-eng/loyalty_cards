import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import {
  crearComercio,
  actualizarComercio,
  eliminarComercio,
  type DatosComercio,
} from './guardarComercio';

const supabase = createServiceClient();
const slugsDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const cuentasDePrueba: string[] = [];

afterEach(async () => {
  if (tarjetasDePrueba.length) {
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas de prueba:', error);
    tarjetasDePrueba.length = 0;
  }
  if (clientesDePrueba.length) {
    const { error } = await supabase.from('clientes').delete().in('id', clientesDePrueba);
    if (error) console.error('[test] no se pudieron borrar los clientes de prueba:', error);
    clientesDePrueba.length = 0;
  }
  if (slugsDePrueba.length) {
    const { data: comerciosDeSlugs } = await supabase.from('comercios').select('id').in('slug', slugsDePrueba);
    const idsDeSlugs = (comerciosDeSlugs ?? []).map((c) => c.id);
    if (idsDeSlugs.length) {
      await supabase.from('sucursales').delete().in('comercio_id', idsDeSlugs);
    }
    const { error } = await supabase.from('comercios').delete().in('slug', slugsDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
    slugsDePrueba.length = 0;
  }
  // DESPUÉS de comercios: cada comercio referencia su cuenta vía cuenta_id, así que borrar las
  // cuentas antes daría un 23503. Orden FK: comercios → cuentas_comercio.
  if (cuentasDePrueba.length) {
    const { error } = await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las cuentas de prueba:', error);
    cuentasDePrueba.length = 0;
  }
});

// Cada comercio de prueba necesita una cuenta real a la que colgarse (cuenta_id es obligatorio en
// la capa lib). Se le pone limite_negocios: 999 —absurdamente alto— para que el límite NUNCA
// interfiera con las pruebas de crear/actualizar branding; el límite tiene su propia suite en
// cuentas.test.ts. Se registra el id para el teardown.
async function cuentaDePrueba(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Test ${sufijo}`, limite_negocios: 999 })
    .select('id')
    .single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function datosValidos(slug: string): Promise<DatosComercio> {
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
    tipo_tarjeta: 'puntos',
    cuenta_id: await cuentaDePrueba(),
  };
}

describe('crearComercio', () => {
  it('crea un comercio con branding', async () => {
    const slug = `test-crear-${Date.now()}`;
    const res = await crearComercio(supabase, await datosValidos(slug));

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('nombre').eq('slug', slug).single();
    expect(data!.nombre).toBe('Comercio Test');
  });

  it('rechaza un slug duplicado con un mensaje claro, sin lanzar', async () => {
    const slug = `test-dup-${Date.now()}`;
    await crearComercio(supabase, await datosValidos(slug));

    const res = await crearComercio(supabase, { ...(await datosValidos(slug)), nombre: 'Otro' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/slug/i);
  });

  it('rechaza un color con formato inválido', async () => {
    const slug = `test-color-${Date.now()}`;
    const res = await crearComercio(supabase, { ...(await datosValidos(slug)), color_fondo: '#231812' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/color/i);
  });

  it('rechaza un nombre vacío', async () => {
    const slug = `test-nombre-${Date.now()}`;
    const res = await crearComercio(supabase, { ...(await datosValidos(slug)), nombre: '   ' });

    expect(res.ok).toBe(false);
    // La BD acepta nombre:'' sin chistar (no hay CHECK) — validar() es la única defensa.
    if (!res.ok) expect(res.error).toMatch(/nombre/i);
  });

  it('rechaza un comercio sin cuenta (cuenta_id vacío)', async () => {
    // MUTATION: quitar el guard `if (!datos.cuenta_id) return 'La cuenta es obligatoria.'` de
    // validar() hace que un cuenta_id vacío NO falle aquí; caería más abajo, en crearComercio,
    // con "No se pudo verificar el límite de la cuenta." (el id '' no es un uuid válido). Se
    // ancla al mensaje EXACTO —no una regex floja— para que el mutante se detecte por la razón
    // correcta. La BD no respalda esta regla (cuenta_id es nullable a propósito): validar() es la
    // única defensa.
    const slug = `test-sin-cuenta-${Date.now()}`;
    const res = await crearComercio(supabase, { ...(await datosValidos(slug)), cuenta_id: '' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('La cuenta es obligatoria.');
  });

  it('rechaza slugs con formato inválido', async () => {
    // El slug es la URL del QR impreso, así que su forma no es cosmética.
    for (const malo of ['Test-Mayusculas', 'con espacios', 'acentué', '']) {
      // Registrar el slug que REALMENTE se inserta: el spread de abajo pisa el de datosValidos(),
      // así que sin esta línea afterEach borraría un slug que nunca existió. No muerde con el
      // código correcto (validar() rechaza los cuatro antes de insertar), pero sí cada vez que
      // se muta la regla del slug — y 'Test-Mayusculas' ni siquiera calza un barrido test-%.
      slugsDePrueba.push(malo);
      const res = await crearComercio(supabase, { ...(await datosValidos(`test-slug-${Date.now()}`)), slug: malo });
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
        ...(await datosValidos(`test-${campo.replace('_', '-')}-${Date.now()}`)),
        [campo]: '#231812',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/color/i);
    }
  });

  it('normaliza espacios y guarda los opcionales vacíos como null', async () => {
    const slug = `test-normalizar-${Date.now()}`;
    const res = await crearComercio(supabase, {
      ...(await datosValidos(slug)),
      nombre: '  Café con Espacios  ',
      color_fondo: '  rgb(35, 24, 18)  ',
      logo_url: '',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre, color_fondo, logo_url')
      .eq('slug', slug)
      .single();
    expect(data!.nombre).toBe('Café con Espacios');
    // validarColorRgb hace su propio .trim() interno, así que sin normalizar ANTES del insert
    // este valor pasaría la validación y se guardaría con los espacios intactos.
    expect(data!.color_fondo).toBe('rgb(35, 24, 18)');
    // El formulario HTML de la Tarea 9 manda '' (nunca null) para un campo opcional vacío.
    expect(data!.logo_url).toBeNull();
  });

  it('guarda el tipo_tarjeta seleccionado', async () => {
    const slug = `test-tipo-${Date.now()}`;
    const res = await crearComercio(supabase, { ...(await datosValidos(slug)), tipo_tarjeta: 'sellos' });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('tipo_tarjeta').eq('slug', slug).single();
    expect(data!.tipo_tarjeta).toBe('sellos');
  });

  it('rechaza un tipo_tarjeta que la BD no acepta', async () => {
    const slug = `test-tipo-malo-${Date.now()}`;
    const res = await crearComercio(supabase, { ...(await datosValidos(slug)), tipo_tarjeta: 'inexistente' });

    expect(res.ok).toBe(false);
    // Sin la validación, esto igual daría ok:false — pero por un 23514 traducido a "No se pudo
    // crear el comercio", que no le dice al admin qué escribió mal.
    if (!res.ok) expect(res.error).toMatch(/tipo/i);
  });
});

describe('actualizarComercio', () => {
  it('actualiza el nombre y branding de un comercio existente', async () => {
    const slug = `test-editar-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, datos);
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, {
      ...datos,
      nombre: 'Nombre Editado',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('nombre')
      .eq('id', creado.id)
      .single();
    expect(data!.nombre).toBe('Nombre Editado');
  });

  it('valida igual que crearComercio', async () => {
    // Esta es LA prueba que faltaba: borrar validar() de actualizarComercio dejaba las 7 pruebas
    // en verde, y guardaba color_fondo:'no-es-un-color' con ok:true — datos que revientan al
    // firmar el pass, en producción, sin que nada los atrape (la BD no respalda esta regla).
    const slug = `test-editar-invalido-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, datos);
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, {
      ...datos,
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
      await datosValidos(`test-fantasma-${Date.now()}`),
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });

  it('actualiza el tipo_tarjeta de un comercio existente', async () => {
    const slug = `test-tipo-editar-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, datos);
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, { ...datos, tipo_tarjeta: 'sellos' });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('tipo_tarjeta').eq('id', creado.id).single();
    expect(data!.tipo_tarjeta).toBe('sellos');
  });

  it('al cambiar de cuenta, cuenta las sucursales propias contra el límite de la cuenta destino', async () => {
    // Mismo caso que el test análogo de asignarComercioACuenta en cuentas.test.ts (Task 2), pero
    // por el camino de "editar comercio y cambiarle la cuenta" en vez del botón "Vincular".
    const cuentaDestino = (await (await import('./cuentas')).crearCuenta(supabase, {
      nombre: `Destino ${Date.now()}`, limiteNegocios: 1, plan: 'starter',
      licenciaEstado: 'activo', licenciaMontoMensual: null, licenciaActivaDesde: null,
    }));
    if (!cuentaDestino.ok) throw new Error('setup falló');
    cuentasDePrueba.push(cuentaDestino.id);

    const slug = `test-mover-cuenta-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, datos);
    if (!creado.ok) throw new Error('el setup falló');
    await supabase.from('sucursales').insert({ comercio_id: creado.id, nombre: 'Sucursal Propia' });

    // Destino ya tiene límite 1 y 0 comercios — cabría el comercio SOLO, pero trae 1 sucursal
    // consigo: 1 (comercio) + 1 (sucursal) = 2 > 1, debe rechazar.
    const res = await actualizarComercio(supabase, creado.id, { ...datos, cuenta_id: cuentaDestino.id });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/límite/i);
  });
});

describe('eliminarComercio', () => {
  it('elimina un comercio sin datos asociados', async () => {
    const slug = `test-eliminar-${Date.now()}`;
    const creado = await crearComercio(supabase, await datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await eliminarComercio(supabase, creado.id);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).toBeNull();
  });

  it('rechaza eliminar un comercio con tarjetas y NO lo borra', async () => {
    const slug = `test-con-tarjeta-${Date.now()}`;
    const creado = await crearComercio(supabase, await datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const telefono = `+000-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data: cliente, error: eCliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente de prueba', telefono })
      .select('id')
      .single();
    if (eCliente) throw eCliente;
    clientesDePrueba.push(cliente.id);

    const { data: tarjeta, error: eTarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: creado.id })
      .select('id')
      .single();
    if (eTarjeta) throw eTarjeta;
    tarjetasDePrueba.push(tarjeta.id);

    const res = await eliminarComercio(supabase, creado.id);

    expect(res.ok).toBe(false);
    // /asociad|eliminar/i era demasiado floja: el mensaje genérico de respaldo ("No se pudo
    // eliminar el comercio.") también la hace matchear, así que esta prueba habría pasado igual
    // aunque se borrara la rama del 23503. Se ancla al mensaje específico para que sí lo cace.
    if (!res.ok) expect(res.error).toMatch(/datos asociados/i);

    // La comprobación que de verdad importa: el comercio SIGUE existiendo. Esta es la misma
    // situación del comercio piloto real en producción, con una tarjeta real ligada a un pass
    // de Apple en el iPhone del usuario — si este assert alguna vez fallara, significaría que
    // el borrado arrastró datos de un cliente real.
    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).not.toBeNull();
  });
});
