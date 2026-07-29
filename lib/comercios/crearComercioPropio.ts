import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { TIPOS_TARJETA, crearComercio } from './guardarComercio';
import { generarSlugUnico } from './slugComercio';

// Alta self-serve de un comercio por el DUEÑO (plan 2026-07-25 §4.6). A diferencia del alta de FM:
//  - la CUENTA nunca viene de un formulario — se deriva del comercio activo de la sesión (control
//    de seguridad: un cuenta_id del cliente dejaría crear comercios en cuentas ajenas);
//  - el slug se autogenera; el branding nace con los defaults del editor de marca (los placeholder
//    del form de FM son blanco/blanco/blanco — tarjeta ilegible) y se termina en /marca.
// La licencia NO se verifica: hoy licencia_estado no gatea ningún flujo del panel comercio
// (solo el admin FM la usa) y este alta mantiene esa política — el cupo es el único tope.

// Los defaults de branding/page.tsx — la carta nace legible y con el acento de la casa.
export const COLORES_DEFAULT = {
  color_fondo: 'rgb(19, 19, 21)',
  color_texto: 'rgb(245, 245, 240)',
  color_label: 'rgb(255, 157, 66)',
} as const;

export interface DatosComercioPropio {
  nombre: string;
  tipoTarjeta: string;
}

export async function crearComercioPropio(
  supabase: SupabaseClient<Database>,
  sesion: { authUserId: string; comercioActivoId: string },
  datos: DatosComercioPropio,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre del comercio es obligatorio.' };

  // Solo los tipos FUNCIONALES hoy (puntos/sellos): el modal no ofrece los "próximamente", y un
  // valor armado a mano tampoco pasa — el <select>/<radio> del cliente nunca es la barrera.
  const tipo = TIPOS_TARJETA.find((t) => t.valor === datos.tipoTarjeta && t.disponible);
  if (!tipo) return { ok: false, error: 'El tipo de tarjeta no es válido.' };

  // 1) Cuenta DERIVADA de la sesión (ver comentario de cabecera).
  const { data: comercioActivo, error: eActivo } = await supabase
    .from('comercios').select('cuenta_id').eq('id', sesion.comercioActivoId).maybeSingle();
  if (eActivo) {
    console.error('[comercio] no se pudo leer el comercio activo para el alta:', eActivo);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }
  const cuentaId = comercioActivo?.cuenta_id;
  if (!cuentaId) return { ok: false, error: 'Tu comercio no está asociado a una cuenta. Escribinos a soporte@cardly-sv.site.' };

  // 2) Email para la membresía nueva: el de la membresía owner ACTUAL (fuente estable — los claims
  //    podrían no traer email).
  const { data: membresiaActual, error: eMembresia } = await supabase
    .from('usuarios_comercio')
    .select('email')
    .eq('comercio_id', sesion.comercioActivoId)
    .eq('auth_user_id', sesion.authUserId)
    .eq('rol', 'owner')
    .eq('activo', true)
    .maybeSingle();
  if (eMembresia || !membresiaActual) {
    console.error('[comercio] no se encontró la membresía owner de la sesión para el alta:', eMembresia);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  // 3) Slug libre.
  const slug = await generarSlugUnico(supabase, nombre);
  if (!slug.ok) return slug;

  // 4) Comercio: crearComercio valida, verifica el cupo de la cuenta y crea la sucursal Principal
  //    (mismo camino que el alta de FM).
  const creado = await crearComercio(supabase, {
    nombre,
    slug: slug.slug,
    ...COLORES_DEFAULT,
    logo_url: null,
    strip_url: null,
    hero_url: null,
    tipo_tarjeta: tipo.valor,
    cuenta_id: cuentaId,
  });
  if (!creado.ok) return creado;

  // 5) Membresía owner del comercio nuevo — sin ella el dueño no podría ni verlo. Si falla,
  //    COMPENSACIÓN best-effort: borrar la principal y el comercio recién creados. Ningún camino
  //    "ok" puede dejar un comercio que el usuario no administra.
  //    Si ADEMÁS falla el delete del comercio (el peor residuo, y lo que hay que buscar cuando
  //    aparezca el console.error de abajo): queda un comercio INVISIBLE — sin membresía no sale en
  //    membresiasDeUsuario, así que el dueño no puede verlo ni borrarlo, pero contarUnidadesCuenta
  //    sí lo cuenta (le come un cupo del plan en silencio) y le retiene el slug. Solo el admin de
  //    FM puede limpiarlo a mano.
  const { error: eInsertMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: creado.id,
    auth_user_id: sesion.authUserId,
    email: membresiaActual.email,
    rol: 'owner',
  });
  if (eInsertMembresia) {
    console.error('[comercio] falló la membresía del comercio nuevo; se revierte el alta:', eInsertMembresia);
    const { error: eSucursales } = await supabase.from('sucursales').delete().eq('comercio_id', creado.id);
    if (eSucursales) console.error('[comercio] no se pudo borrar la principal en la compensación:', eSucursales);
    // El programa principal (0024, creado dentro de crearComercio vía crearProgramaPrincipal) es
    // OTRA FK hacia comercios — sin retirarlo primero, el delete de comercios de abajo falla con
    // 23503 y la compensación deja un comercio huérfano (sin membresía, invisible para el dueño,
    // pero contando cupo del plan). Mismo motivo que las sucursales de la línea de arriba.
    const { error: eProgramas } = await supabase.from('programas_tarjeta').delete().eq('comercio_id', creado.id);
    if (eProgramas) console.error('[comercio] no se pudo borrar el programa principal en la compensación:', eProgramas);
    const { error: eComercio } = await supabase.from('comercios').delete().eq('id', creado.id);
    if (eComercio) console.error('[comercio] no se pudo borrar el comercio en la compensación:', eComercio);
    return { ok: false, error: 'No se pudo crear el comercio. Intentá de nuevo.' };
  }

  return { ok: true, id: creado.id };
}
