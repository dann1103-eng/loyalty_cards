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
const programasDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const cuentasDePrueba: string[] = [];

afterEach(async () => {
  if (tarjetasDePrueba.length) {
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas de prueba:', error);
    tarjetasDePrueba.length = 0;
  }
  if (programasDePrueba.length) {
    // DESPUÉS de tarjetas (que lo referencian) y ANTES de comercios (al que el programa referencia).
    const { error } = await supabase.from('programas_tarjeta').delete().in('id', programasDePrueba);
    if (error) console.error('[test] no se pudieron borrar los programas de prueba:', error);
    programasDePrueba.length = 0;
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
      // Orden FK: usuarios_comercio apunta a comercios Y a sucursales, así que va PRIMERO —
      // borrar la sucursal antes daría 23503 y dejaría basura en la BD real de QA. programas_tarjeta
      // (0024) es la misma historia: crearComercio le crea su principal a TODO comercio ahora, así
      // que sin borrarlo acá el delete de comercios de abajo fallaría en silencio (console.error,
      // no throw) para cada prueba de este archivo — dejando basura real acumulándose.
      await supabase.from('usuarios_comercio').delete().in('comercio_id', idsDeSlugs);
      await supabase.from('sucursales').delete().in('comercio_id', idsDeSlugs);
      await supabase.from('programas_tarjeta').delete().in('comercio_id', idsDeSlugs);
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

describe('el tipo de tarjeta que edita FM llega al PROGRAMA', () => {
  // Desde la 0024 el tipo que rige de verdad —el que dibuja el pase, el que el escáner usa para
  // elegir la operación y el que los reportes leen— vive en `programas_tarjeta`, no en `comercios`.
  //
  // `actualizarComercio` escribía SOLO la columna del comercio. O sea que FM cambiaba el tipo en su
  // panel, veía el tipo nuevo guardado, y para el comercio no cambiaba absolutamente nada. Un
  // "guardado" que miente y que nadie tiene cómo diagnosticar.

  it('propaga el tipo nuevo al programa principal', async () => {
    const slug = `test-tipo-propaga-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, datos);
    if (!creado.ok) throw new Error('el setup falló');

    const res = await actualizarComercio(supabase, creado.id, { ...datos, tipo_tarjeta: 'sellos' });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const { data: principal } = await supabase
      .from('programas_tarjeta')
      .select('tipo_tarjeta')
      .eq('comercio_id', creado.id)
      .eq('es_principal', true)
      .single();
    expect(principal!.tipo_tarjeta, 'el tipo se guardó en comercios pero no llegó al programa').toBe('sellos');
  });

  it('NO cambia el tipo de un programa que ya tiene tarjetas emitidas', async () => {
    // La otra mitad, y es la que importa: `puntos_actuales` es un contador universal cuyo
    // significado depende del tipo. Cambiar de 'cashback' a 'sellos' con tarjetas vivas convierte
    // los centavos de cada cliente en sellos — $12.50 pasa a ser 1250 sellos. Por eso
    // guardarConfiguracionPrograma tampoco deja cambiar el tipo, y acá se respeta lo mismo.
    const slug = `test-tipo-con-tarjetas-${Date.now()}`;
    const datos = await datosValidos(slug);
    const creado = await crearComercio(supabase, { ...datos, tipo_tarjeta: 'cashback' });
    if (!creado.ok) throw new Error('el setup falló');

    const { data: principal } = await supabase
      .from('programas_tarjeta').select('id').eq('comercio_id', creado.id).eq('es_principal', true).single();
    const { data: cliente } = await supabase
      .from('clientes')
      .insert({ nombre: 'Cliente Test', telefono: `+503${String(Date.now()).slice(-8)}` })
      .select('id').single();
    clientesDePrueba.push(cliente!.id);
    const { data: tarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente!.id, comercio_id: creado.id, programa_id: principal!.id, puntos_actuales: 1250 })
      .select('id').single();
    tarjetasDePrueba.push(tarjeta!.id);

    const res = await actualizarComercio(supabase, creado.id, { ...datos, tipo_tarjeta: 'sellos' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('tarjeta');
    const { data: despues } = await supabase
      .from('programas_tarjeta').select('tipo_tarjeta').eq('id', principal!.id).single();
    expect(despues!.tipo_tarjeta, 'le cambió el tipo a un programa con saldos vivos').toBe('cashback');
  });
});

describe('sucursal principal en el alta (0012)', () => {
  it('mover un comercio a otra cuenta NO cuenta su principal (gemelo del de asignarComercioACuenta)', async () => {
    // actualizarComercio tiene SU PROPIO conteo de sucursales propias — el .eq('es_principal',
    // false) de allá necesita su propia prueba, o esa copia puede regresar sin que nadie se entere.
    // Espeja el test vecino "al cambiar de cuenta, cuenta las sucursales propias…" pero con un
    // destino de límite 2 que SÍ debe aceptar el move: 1 comercio + 1 sucursal adicional (la
    // principal viaja gratis con su comercio).
    const cuentaDestino = await (await import('./cuentas')).crearCuenta(supabase, {
      nombre: `Destino principal ${Date.now()}`, limiteNegocios: 2, plan: 'growth',
      licenciaEstado: 'activo', licenciaMontoMensual: null, licenciaActivaDesde: null,
    });
    if (!cuentaDestino.ok) throw new Error('setup falló');
    cuentasDePrueba.push(cuentaDestino.id);

    const datos = await datosValidos(`test-mover-principal-${Date.now()}`);
    const creado = await crearComercio(supabase, datos); // crea también su Principal
    if (!creado.ok) throw new Error('el setup falló');
    const { error } = await supabase.from('sucursales').insert({ comercio_id: creado.id, nombre: 'Sucursal Propia' });
    if (error) throw error;

    const res = await actualizarComercio(supabase, creado.id, { ...datos, cuenta_id: cuentaDestino.id });
    expect(res.ok).toBe(true);
  });

  it('crearComercio crea el comercio Y su sucursal Principal activa', async () => {
    const res = await crearComercio(supabase, await datosValidos(`test-alta-principal-${Date.now()}`));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { data } = await supabase
      .from('sucursales').select('nombre, activa, es_principal').eq('comercio_id', res.id);
    expect(data).toEqual([{ nombre: 'Principal', activa: true, es_principal: true }]);
  });

  it('si el insert de la principal falla, el comercio igual se crea (best-effort)', async () => {
    // Inyección de fallo puntual: la integración real no puede hacer fallar SOLO ese insert.
    // La cuenta del fixture es NUEVA (0 comercios al verificar el límite), así que el único
    // acceso a 'sucursales' dentro de crearComercio es el insert de la principal.
    const real = createServiceClient();
    const conSucursalesRotas = {
      from(tabla: string) {
        if (tabla !== 'sucursales') return real.from(tabla as never);
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: 'roto a propósito' } }),
            }),
          }),
        } as never;
      },
      // `as unknown as` y no un cast directo: el objeto solo implementa `from`, así que TS lo
      // rechaza con TS2352 ("no se superponen lo suficiente") contra el cliente completo.
    } as unknown as ReturnType<typeof createServiceClient>;

    const res = await crearComercio(conSucursalesRotas, await datosValidos(`test-principal-rota-${Date.now()}`));
    expect(res.ok).toBe(true); // el comercio NO se pierde por la principal
    if (!res.ok) return;
    const { data } = await real.from('sucursales').select('id').eq('comercio_id', res.id);
    expect(data).toEqual([]); // quedó sin principal: crearSucursal la auto-repara después
  });
});

describe('eliminarComercio', () => {
  it('elimina un comercio sin datos asociados', async () => {
    // Desde la 0012 este comercio NACE con su sucursal Principal, cuya FK hacia comercios tampoco
    // tiene cascada (0008): sin el retiro de la principal que hace eliminarComercio, este caso —el
    // botón "Eliminar" del panel FM sobre un comercio recién creado— daría 23503 para SIEMPRE.
    const slug = `test-eliminar-${Date.now()}`;
    const creado = await crearComercio(supabase, await datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const res = await eliminarComercio(supabase, creado.id);
    expect(res.ok).toBe(true);

    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).toBeNull();

    // Y su Principal se fue con él: la sucursal referencia al comercio, así que dejarla sería una
    // fila huérfana apuntando a un id que ya no existe.
    const { data: huerfanas } = await supabase.from('sucursales').select('id').eq('comercio_id', creado.id);
    expect(huerfanas).toEqual([]);
  });

  it('un borrado rechazado repone la principal VERBATIM, sin renombrarla', async () => {
    // El retiro de la principal es quirúrgico (SOLO ella; la sucursal del dueño sigue bloqueando el
    // borrado) y la reposición es IDÉNTICA. Esto último no es cosmético: la principal suele ser una
    // fila del DUEÑO —el backfill de la 0012 ascendió la más antigua con su nombre, y en producción
    // la de "Verde Raíz" se llama "Centro Santa Ana"—, así que reponer un genérico 'Principal' la
    // renombraría en silencio desde un botón que ni siquiera borró nada.
    const slug = `test-eliminar-con-sucursal-${Date.now()}`;
    const creado = await crearComercio(supabase, await datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    // La principal, renombrada por el dueño (renombrarSucursal no se lo impide) y con su fecha.
    const { data: antes, error: eRenombrar } = await supabase
      .from('sucursales').update({ nombre: 'Centro Santa Ana' })
      .eq('comercio_id', creado.id).eq('es_principal', true)
      .select('id, nombre, activa, created_at').single();
    if (eRenombrar) throw eRenombrar;
    const { error: eSucursal } = await supabase
      .from('sucursales').insert({ comercio_id: creado.id, nombre: 'Sucursal del Dueño' });
    if (eSucursal) throw eSucursal;

    const res = await eliminarComercio(supabase, creado.id);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/datos asociados/i);

    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).not.toBeNull();

    // Byte por byte lo que había: mismo id (nada quedó colgando), mismo nombre y misma created_at.
    const { data: despues } = await supabase
      .from('sucursales').select('id, nombre, activa, created_at, es_principal')
      .eq('comercio_id', creado.id).eq('es_principal', true).single();
    expect(despues).toEqual({ ...antes, es_principal: true });

    // Y la del dueño sigue ahí: el retiro no se la llevó.
    const { data: todas } = await supabase
      .from('sucursales').select('nombre').eq('comercio_id', creado.id).eq('es_principal', false);
    expect(todas).toEqual([{ nombre: 'Sucursal del Dueño' }]);
  });

  it('rechaza eliminar un comercio self-serve nombrando los accesos, y le repone la principal', async () => {
    // El caso REAL más común: crearComercioPropio siempre inserta la membresía owner (sin ella el
    // dueño no vería su comercio), con sucursal_id null — así que NO bloquea el retiro de la
    // principal, bloquea el delete del comercio. Antes de este arreglo el admin leía "tiene datos
    // asociados (tarjetas, reglas de puntos, recompensas o sucursales)" y salía a buscar cuatro
    // cosas que no existían. Las membresías NO se retiran a propósito (ver DEUDA CONOCIDA en
    // guardarComercio.ts): esta prueba fija que el bloqueo es honesto, no que desaparezca.
    const slug = `test-eliminar-self-serve-${Date.now()}`;
    const creado = await crearComercio(supabase, await datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const { data: antes, error: ePrincipal } = await supabase
      .from('sucursales').select('id, nombre, activa, created_at')
      .eq('comercio_id', creado.id).eq('es_principal', true).single();
    if (ePrincipal) throw ePrincipal;
    // Igual que crearComercioPropio: rol owner, SIN sucursal_id.
    const { error: eOwner } = await supabase.from('usuarios_comercio').insert({
      comercio_id: creado.id,
      email: `owner-self-serve-${Date.now()}-${Math.random().toString(36).slice(2)}@test.fm`,
      rol: 'owner',
    });
    if (eOwner) throw eOwner;

    const res = await eliminarComercio(supabase, creado.id);

    expect(res.ok).toBe(false);
    // La causa verdadera, nombrada. La regex floja /datos asociados/i pasaría igual con el mensaje
    // viejo y mentiroso, así que se ancla a los accesos.
    if (!res.ok) expect(res.error).toMatch(/accesos de dueño\/cajero/i);

    const { data: comercio } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(comercio).not.toBeNull();

    // Y la principal volvió idéntica: el retiro SÍ ocurrió (la membresía no la referencia), así que
    // este es un camino real de compensación, no uno donde no se retiró nada.
    const { data: despues } = await supabase
      .from('sucursales').select('id, nombre, activa, created_at')
      .eq('comercio_id', creado.id).eq('es_principal', true).single();
    expect(despues).toEqual(antes);
  });

  it('rechaza eliminar si la principal tiene un cajero asignado, nombrando la causa real', async () => {
    // Camino del 23503 EN EL RETIRO (no en el delete del comercio): usuarios_comercio.sucursal_id
    // apunta a la principal, así que ni siquiera se puede retirar. Es justo el caso que la 0012 vino
    // a habilitar —cajeros sobre la principal— y el mensaje tiene que nombrar la causa verdadera:
    // decir "tarjetas" mandaría al admin a buscar algo que no existe.
    const slug = `test-eliminar-con-cajero-${Date.now()}`;
    const creado = await crearComercio(supabase, await datosValidos(slug));
    if (!creado.ok) throw new Error('el setup falló');

    const { data: principal, error: ePrincipal } = await supabase
      .from('sucursales').select('id').eq('comercio_id', creado.id).eq('es_principal', true).single();
    if (ePrincipal) throw ePrincipal;
    const { error: eCajero } = await supabase.from('usuarios_comercio').insert({
      comercio_id: creado.id,
      email: `cajero-principal-${Date.now()}-${Math.random().toString(36).slice(2)}@test.fm`,
      rol: 'cajero',
      sucursal_id: principal.id,
    });
    if (eCajero) throw eCajero;

    const res = await eliminarComercio(supabase, creado.id);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe(
        'No se puede eliminar: la sucursal principal tiene actividad asociada (cajeros, transacciones o canjes). Solo se pueden eliminar comercios sin actividad.',
      );
    }

    // Nada se movió: el comercio y su principal siguen intactos.
    const { data: comercio } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(comercio).not.toBeNull();
    const { data: sigue } = await supabase.from('sucursales').select('id').eq('id', principal.id).maybeSingle();
    expect(sigue).not.toBeNull();
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

    // crearComercio() (guardarComercio.ts) YA crea el programa principal (migración 0024, vía
    // crearProgramaPrincipal) — antes se armaba acá a mano, pero ahora insertar un segundo
    // 'principal' chocaría con el unique (comercio_id, slug). Se lee de vuelta el que ya existe.
    const { data: programa, error: ePrograma } = await supabase
      .from('programas_tarjeta')
      .select('id')
      .eq('comercio_id', creado.id)
      .eq('es_principal', true)
      .single();
    if (ePrograma) throw ePrograma;
    programasDePrueba.push(programa.id);

    const { data: tarjeta, error: eTarjeta } = await supabase
      .from('tarjetas')
      .insert({ cliente_id: cliente.id, comercio_id: creado.id, programa_id: programa.id })
      .select('id')
      .single();
    if (eTarjeta) throw eTarjeta;
    tarjetasDePrueba.push(tarjeta.id);

    const res = await eliminarComercio(supabase, creado.id);

    expect(res.ok).toBe(false);
    // Con una tarjeta real, el bloqueo ocurre al intentar retirar el programa PRINCIPAL (la
    // tarjeta lo referencia) — antes de llegar siquiera al delete de comercios — así que el
    // mensaje específico es el del programa, no el genérico de "datos asociados".
    if (!res.ok) expect(res.error).toBe('No se puede eliminar: el programa principal tiene tarjetas de clientes. Solo se pueden eliminar comercios sin actividad.');

    // La comprobación que de verdad importa: el comercio SIGUE existiendo. Esta es la misma
    // situación del comercio piloto real en producción, con una tarjeta real ligada a un pass
    // de Apple en el iPhone del usuario — si este assert alguna vez fallara, significaría que
    // el borrado arrastró datos de un cliente real.
    const { data } = await supabase.from('comercios').select('id').eq('id', creado.id).maybeSingle();
    expect(data).not.toBeNull();

    // Y con él, su Principal REPUESTA: eliminarComercio la retira antes de intentar el delete, así
    // que un borrado rechazado que no la reponga dejaría al comercio sin principal —sin cupo mal
    // contado pero sin sucursal donde poner cajeros— por un botón que ni siquiera borró nada.
    const { data: principal } = await supabase
      .from('sucursales').select('nombre, es_principal').eq('comercio_id', creado.id);
    expect(principal).toEqual([{ nombre: 'Principal', es_principal: true }]);
  });
});
