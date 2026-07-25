import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from './validarColorRgb';
import { verificarLimiteCuenta } from './cuentas';

// Fuente única de verdad del catálogo de tipos de tarjeta: la BD tiene
// check (tipo_tarjeta in (...8 valores...)) en la migración 0005. El <select> de FM (Tarea 3) se
// construye desde esta MISMA constante. `disponible: false` = el tipo existe en el catálogo pero
// su lógica de saldo/canje no está construida esta fase (aparece "(Próximamente)" y deshabilitado).
// Solo 'puntos' y 'sellos' son funcionales hoy (spec §4.1, §7).
export const TIPOS_TARJETA = [
  { valor: 'puntos', etiqueta: 'Puntos', descripcion: 'Suma puntos por visita o por monto.', disponible: true },
  { valor: 'sellos', etiqueta: 'Sellos', descripcion: 'Junta sellos hacia una meta (ej. 9 y la 10 gratis).', disponible: true },
  { valor: 'cashback', etiqueta: 'Cashback', descripcion: 'Reembolso hacia compras futuras.', disponible: false },
  { valor: 'membresia', etiqueta: 'Membresías', descripcion: 'Club VIP por niveles.', disponible: false },
  { valor: 'descuento', etiqueta: 'Descuento', descripcion: 'Ventas al por mayor.', disponible: false },
  { valor: 'cupon', etiqueta: 'Cupón', descripcion: 'Uso único; se convierte en otro tipo tras canjear.', disponible: false },
  { valor: 'prepago', etiqueta: 'Prepago', descripcion: 'Tarjetas de sellos prepagadas.', disponible: false },
  { valor: 'gift_card', etiqueta: 'Gift Card', descripcion: 'Saldo de regalo prepagado.', disponible: false },
] as const;
export type TipoTarjeta = (typeof TIPOS_TARJETA)[number]['valor'];

export interface DatosComercio {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string | null;
  strip_url: string | null;
  hero_url: string | null;
  tipo_tarjeta: string;
  // La cuenta (cliente que paga) a la que pertenece el comercio. Obligatorio en la capa app —
  // la columna es nullable en la BD a propósito (migración 0008), así que validar() es la única
  // defensa, igual que con los colores.
  cuenta_id: string;
}

export type ResultadoGuardar =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Un opcional vacío es null, no ''. El formulario HTML de la Tarea 9 manda siempre string:
// un campo que el usuario dejó en blanco llega como '', y guardarlo tal cual metería cadenas
// vacías donde la columna espera NULL.
function limpiarOpcional(valor: string | null): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

// Normaliza ANTES de validar para que se valide EXACTAMENTE lo que se almacena. Sin esto,
// validarColorRgb —que hace su propio .trim() interno— aprobaría '  rgb(0,0,0)  ' y el valor
// se guardaría con los espacios puestos.
function normalizar(datos: DatosComercio): DatosComercio {
  return {
    ...datos,
    nombre: datos.nombre.trim(),
    slug: datos.slug.trim(),
    color_fondo: datos.color_fondo.trim(),
    color_texto: datos.color_texto.trim(),
    color_label: datos.color_label.trim(),
    logo_url: limpiarOpcional(datos.logo_url),
    strip_url: limpiarOpcional(datos.strip_url),
    hero_url: limpiarOpcional(datos.hero_url),
    tipo_tarjeta: datos.tipo_tarjeta.trim(),
    cuenta_id: datos.cuenta_id.trim(),
  };
}

// Devuelve el primer problema encontrado, o null si todo está bien.
// TODA la validación vive aquí, no en los Server Actions: esta es la capa con tests de
// integración. Una regla que solo exista en la acción no está cubierta por ninguna prueba.
function validar(datos: DatosComercio): string | null {
  // La cuenta va primero: sin ella no hay contra qué verificar el límite de negocios, y la BD la
  // acepta null sin chistar (columna nullable de la 0008) — validar() es la única defensa.
  if (!datos.cuenta_id) return 'La cuenta es obligatoria.';
  if (!datos.nombre) return 'El nombre es obligatorio.';
  if (!/^[a-z0-9-]+$/.test(datos.slug)) {
    return 'El slug solo puede tener minúsculas, números y guiones.';
  }
  if (!TIPOS_TARJETA.some((t) => t.valor === datos.tipo_tarjeta)) {
    // Sin esto, un valor inválido cae en un 23514 de la BD que el manejo de errores (solo
    // distingue 23505) convierte en un genérico "No se pudo crear el comercio". Se valida contra
    // los 8 valores válidos de la BD (no solo los `disponible`): el <select> ya deshabilita los no
    // disponibles, y el pass renderiza cualquier tipo != 'sellos' como número de forma segura, así
    // que un tipo no disponible guardado no rompe nada.
    return 'El tipo de tarjeta no es válido.';
  }
  const colores: [string, string][] = [
    ['color de fondo', datos.color_fondo],
    ['color de texto', datos.color_texto],
    ['color de etiqueta', datos.color_label],
  ];
  for (const [nombre, valor] of colores) {
    if (!validarColorRgb(valor)) {
      return `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.`;
    }
  }
  return null;
}

export async function crearComercio(
  supabase: SupabaseClient<Database>,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  // El límite de negocios de la cuenta se aplica ANTES del insert: crear un comercio consume un
  // cupo, así que una cuenta llena debe rechazar el alta con un mensaje claro (no un error de BD).
  const limite = await verificarLimiteCuenta(supabase, limpios.cuenta_id);
  if (!limite.ok) return { ok: false, error: limite.error };

  const { data, error } = await supabase.from('comercios').insert(limpios).select('id').single();

  if (error) {
    // 23505 = unique violation. El único unique aquí es el slug.
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe un comercio con el slug "${limpios.slug}".` };
    }
    console.error('[fm] falló el insert de comercio:', error);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  return { ok: true, id: data.id };
}

// El slug es editable a propósito, aunque sea la URL del QR físico pegado en la tienda
// (/registro/[comercioSlug]). Un typo al crear ("cafeteria-pilotoo") tiene que poder arreglarse, y
// volverlo inmutable obligaría a borrar y recrear, arrastrando las tarjetas existentes.
// Lo que SÍ se rompe al cambiarlo: los registros nuevos desde el QR ya impreso, que caen en un
// "Comercio no encontrado" silencioso — sin error, sin log, sin alerta. Lo que NO se rompe: los
// passes ya emitidos, cuyo código de barras es tarjetas.qr_token, no el slug. Por eso el
// formulario de la Tarea 9 debe pedir confirmación explícita al cambiar el slug de un comercio
// que ya existe.
export async function actualizarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  // Si el edit MUEVE el comercio a otra cuenta, la cuenta DESTINO tiene que tener cupo. Se lee el
  // cuenta_id actual y solo se verifica cuando cambia: reguardar el mismo comercio en su cuenta no
  // debe bloquearse a sí mismo (por eso el excluyendoComercioId). Si el comercio ya no existe, la
  // lectura no devuelve fila (data:null, error:null) y se salta el chequeo — el update de abajo lo
  // reporta con PGRST116. Un ERROR de la lectura (infra), en cambio, falla CERRADO: no se puede
  // saltar el chequeo de límite por un fallo transitorio (coherente con verificarLimiteCuenta).
  const { data: actual, error: eActual } = await supabase
    .from('comercios')
    .select('cuenta_id')
    .eq('id', id)
    .maybeSingle();
  if (eActual) {
    console.error('[fm] no se pudo leer el comercio para verificar el límite:', eActual);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }
  if (actual && actual.cuenta_id !== limpios.cuenta_id) {
    // El comercio que cambia de cuenta trae sus propias sucursales — igual que
    // asignarComercioACuenta en cuentas.ts, hay que contarlas y pasarlas como unidadesAAgregar.
    const { count: sucursalesPropias, error: eSucursales } = await supabase
      .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', id);
    if (eSucursales) {
      console.error('[fm] no se pudo contar las sucursales del comercio a reasignar:', eSucursales);
      return { ok: false, error: 'No se pudo actualizar el comercio.' };
    }
    const limite = await verificarLimiteCuenta(supabase, limpios.cuenta_id, {
      excluyendoComercioId: id,
      unidadesAAgregar: 1 + (sucursalesPropias ?? 0),
    });
    if (!limite.ok) return { ok: false, error: limite.error };
  }

  const { error } = await supabase
    .from('comercios')
    .update(limpios)
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe otro comercio con el slug "${limpios.slug}".` };
    }
    // PGRST116 = la consulta no devolvió exactamente una fila. El .select('id').single() de
    // arriba NO es decorativo: sin él, un update que no toca NADA devuelve 204 sin error y esto
    // reportaría ok:true habiendo escrito cero. Y .select('id') solo tampoco basta — devuelve []
    // sin error; hace falta el .single(). Dos rutas llegan aquí: un id que ya no existe, o un
    // cliente sin permiso — comercios es deny-all bajo RLS desde la 0001, así que pasar un
    // createClienteServidor() haría no-op silencioso en TODOS los updates.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[fm] falló el update de comercio:', error);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }

  return { ok: true, id };
}

// Ningún FK hacia comercios tiene ON DELETE CASCADE (migración 0001: usuarios_comercio,
// tarjetas, reglas_puntos y recompensas apuntan aquí sin cascada) — a propósito, para que
// borrar un comercio NUNCA arrastre en silencio datos reales de un cliente. Postgres es la
// única fuente de verdad de esa regla: no la duplicamos contando filas en JS, que podría
// desincronizarse si el esquema cambia. Solo traducimos el 23503 a un mensaje legible.
//
// PRECONDICIÓN: `supabase` DEBE ser createServiceClient(). Un id ya borrado da ok:true a
// propósito (idempotente) — pero eso solo es seguro si `supabase` ignora RLS. Con un cliente
// de sesión, comercios es deny-all desde la 0001: un update bloqueado por RLS y un id que ya
// no existe devolverían el mismo ok:true, indistinguibles. No se agrega .select().single()
// para detectarlo (a diferencia de actualizarComercio) porque eso rompería la idempotencia
// legítima del caso "ya borrado" — la única defensa real es no llamar esto con otro cliente.
export async function eliminarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('comercios').delete().eq('id', id);

  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        error:
          'No se puede eliminar: tiene datos asociados (tarjetas, reglas de puntos o recompensas). Solo se pueden eliminar comercios sin actividad.',
      };
    }
    console.error('[fm] falló el borrado de comercio:', error);
    return { ok: false, error: 'No se pudo eliminar el comercio.' };
  }

  return { ok: true };
}
