'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';
// Importado, NO copiado: es el mismo largo mínimo que exige crearCajero. Dos literales sueltos se
// desincronizan en silencio el día que alguien suba el mínimo en un solo lado. La BD no valida
// nada de esto — esta capa es la única defensa.
import { PASSWORD_MIN } from '@/lib/comercio/cajeros';

export type EstadoClave = { error: string } | undefined;

// SEGURIDAD: la contraseña que elige el cliente NUNCA se loguea. No hay ningún console.* con
// formData, con la contraseña ni con el objeto de error completo — de un error de Auth solo sale
// error.message, igual que en cajeros.ts. Tampoco vuelve al formulario en el estado.
export async function definirClave(
  _estadoPrevio: EstadoClave,
  formData: FormData,
): Promise<EstadoClave> {
  // Gate propio: un Server Action es un POST a esta ruta, así que re-verifica por su cuenta en vez
  // de confiar en la página o en proxy.ts. NO usa verifyComercioAcceso: ése exige además membresía
  // y comercio activo y redirige a /elegir — acá lo único que hace falta es que la sesión exista
  // (la creó /comercio/activar). getClaims() y redirect() van FUERA de todo try/catch: redirect()
  // funciona LANZANDO NEXT_REDIRECT y envolverlo desactivaría el gate.
  const supabase = await createClienteServidor();
  const { data, error: errorSesion } = await supabase.auth.getClaims();
  if (errorSesion) {
    console.warn('[comercio] getClaims() falló al definir la clave; se trata como sesión ausente:', errorSesion);
  }
  if (!data?.claims?.sub) {
    // La sesión de la activación vence: pedirle a FM un link nuevo es exactamente lo que hay que
    // hacer, y ese es el mensaje de `link-vencido` en el login.
    redirect('/comercio/login?error=link-vencido');
  }

  const password = String(formData.get('password') ?? '');
  const confirmacion = String(formData.get('confirmacion') ?? '');

  if (password.length < PASSWORD_MIN) {
    return { error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.` };
  }
  if (password !== confirmacion) {
    return { error: 'Las dos contraseñas no coinciden. Escribilas de nuevo.' };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error('[comercio] falló updateUser al definir la clave:', error.message);
    // Los dos códigos que el cliente PUEDE arreglar solo. El resto es genérico a propósito.
    if (error.code === 'same_password') {
      // Caso real del link de recuperación: pidió uno nuevo y después se acordó de su clave. Sin
      // el segundo consejo esta pantalla sería un callejón sin salida (Auth no deja "cambiarla"
      // por la misma); el enlace al panel está justo debajo del formulario.
      return { error: 'Esa ya es tu contraseña actual. Elegí una distinta, o entrá directo a tu panel.' };
    }
    if (error.code === 'weak_password') {
      return { error: 'Esa contraseña es muy fácil de adivinar. Probá con una más larga.' };
    }
    return { error: 'No se pudo guardar la contraseña. Volvé a intentar en un momento.' };
  }

  // El layout del panel se arma con los datos de la sesión; sin esto podría servirse una versión
  // cacheada de antes de la activación.
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/panel');
}
