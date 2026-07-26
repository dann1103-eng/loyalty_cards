import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Slug autogenerado para el alta self-serve: el dueño no ve el campo (FM puede editarlo después
// desde su panel). Debe cumplir el regex de validar(): ^[a-z0-9-]+$.
export function slugificarNombre(nombre: string): string {
  const base = nombre
    .toLowerCase()
    .normalize('NFD') // separa letra y acento: "café" → "cafe" + diacrítico (la ñ → n + tilde)
    .replace(/[\u0300-\u036f]/g, '') // borra los diacríticos combinantes que dejó NFD
    .replace(/[^a-z0-9]+/g, '-') // todo lo demás (espacios, símbolos) → un guion
    .replace(/^-+|-+$/g, ''); // sin guiones en los bordes
  return base || 'comercio'; // un nombre sin nada usable (p. ej. "!!!") no puede dar slug vacío
}

// Busca un slug LIBRE: el base, o base-2..base-5. Se PRE-verifica con un select porque
// crearComercio traduce el 23505 a un mensaje (no expone el código) y matchear mensajes sería
// frágil. Una colisión residual por carrera entre este select y el insert devuelve el error de
// crearComercio tal cual (el usuario reintenta). Tope de 5: evita un loop infinito en un caso
// ~imposible.
//
// PRECONDICIÓN: `supabase` DEBE ser createServiceClient(). comercios es deny-all bajo RLS desde la
// 0001, así que con un createClienteServidor() cada select de acá devuelve data:null y error:null
// —indistinguible de "el slug está libre"—: la función respondería SIEMPRE ok:true con el base y
// toda la pre-verificación sería un no-op silencioso, con la colisión reventando recién en el
// insert. Mismo peligro que ya documentan actualizarComercio y eliminarComercio.
export async function generarSlugUnico(
  supabase: SupabaseClient<Database>,
  nombre: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const base = slugificarNombre(nombre);
  for (let i = 1; i <= 5; i++) {
    const candidato = i === 1 ? base : `${base}-${i}`;
    const { data, error } = await supabase
      .from('comercios').select('id').eq('slug', candidato).maybeSingle();
    if (error) {
      console.error('[comercio] no se pudo verificar la disponibilidad del slug:', error);
      return { ok: false, error: 'No se pudo crear el comercio.' };
    }
    if (!data) return { ok: true, slug: candidato };
  }
  return { ok: false, error: 'No se pudo generar una dirección única, cambiá el nombre.' };
}
