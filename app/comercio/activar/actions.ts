'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClienteServidor } from '@/lib/supabase/server';
import { COOKIE_COMERCIO_ACTIVO, COOKIE_SUCURSAL_ACTIVA } from '@/lib/comercio/cookieComercio';

// Canje del link de invitación. Vive en una Server Action (POST) y NO en el GET de la página a
// propósito: el token es de UN SOLO USO y WhatsApp —como todo mensajero— abre el link con un GET
// para armar la vista previa del mensaje. Con el canje en el GET, ese preview quemaba el token
// ANTES de que el cliente lo tocara, y el dueño llegaba a "Ese link ya no sirve" sin haber hecho
// nada. Pasó en producción el 2026-07-26. Los previews no hacen POST: por eso el canje va acá,
// detrás de un botón. NO muevas esto de vuelta al GET.
//
// SEGURIDAD: `tokenHash` es una credencial temporal. NUNCA se loguea (de un error de Auth solo sale
// error.message). redirect() LANZA NEXT_REDIRECT → va fuera de cualquier try/catch.

// Los dos únicos tipos que emite generarAccesoDueno: 'invite' para un dueño nuevo en Auth,
// 'recovery' para uno que ya existía. Whitelist a propósito: sin ella esta acción canjearía
// cualquier OTP que alguien le pegue en el formulario (un 'email_change', por ejemplo).
const TIPOS_ACEPTADOS = ['invite', 'recovery'] as const;
type TipoAceptado = (typeof TIPOS_ACEPTADOS)[number];

function esTipoAceptado(valor: string): valor is TipoAceptado {
  return (TIPOS_ACEPTADOS as readonly string[]).includes(valor);
}

export type EstadoActivacion = { error: string } | undefined;

export async function activarAcceso(
  _estadoPrevio: EstadoActivacion,
  formData: FormData,
): Promise<EstadoActivacion> {
  const tokenHash = String(formData.get('token_hash') ?? '');
  const tipo = String(formData.get('tipo') ?? '');

  if (!tokenHash || !esTipoAceptado(tipo)) {
    return { error: 'Ese link de acceso no es válido. Pedile a FM un link nuevo.' };
  }

  const supabase = await createClienteServidor();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });

  if (error) {
    // Solo error.message: el objeto completo del error puede arrastrar lo que se envió.
    console.warn('[comercio] no se pudo canjear el link de acceso:', error.message);

    // El token es de un solo uso y vence a las 24 h. Si ya hay sesión (la creó un canje anterior),
    // mandarlo al login sería absurdo: sigue a definir su clave, que es donde estaba.
    // verifyOtp NO borra la sesión existente cuando falla, así que este getClaims es confiable.
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      redirect('/comercio/clave');
    }
    return {
      error: 'Ese link de acceso ya no sirve: se usa una sola vez y vence a las 24 horas. Pedile a FM un link nuevo.',
    };
  }

  // Sesión nueva = contexto de comercio/sucursal en blanco. En un teléfono compartido estas cookies
  // pueden ser del dueño ANTERIOR; los gates igual las revalidan contra las membresías reales, pero
  // se limpian acá por la misma razón que en iniciarSesionComercio.
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_COMERCIO_ACTIVO);
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);

  redirect('/comercio/clave');
}
