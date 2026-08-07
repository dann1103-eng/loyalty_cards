'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { crearCuentaAutoservicio } from '@/lib/comercios/altaAutoservicio';
import {
  COOKIE_COMERCIO_ACTIVO,
  COOKIE_SUCURSAL_ACTIVA,
  opcionesCookieComercio,
} from '@/lib/comercio/cookieComercio';

export type EstadoRegistro = { error: string } | undefined;

// Alta self-service desde el sitio público. Crea todo y DEJA AL DUEÑO ADENTRO: no le pide que vaya
// a buscar un correo ni que vuelva a teclear la clave que acaba de elegir. Ese salto es donde se
// pierde la gente.
//
// Esta ruta es pública a propósito y no la toca el proxy: su matcher solo cubre /admin y /comercio
// (ver proxy.ts). Si algún día ese matcher se amplía, hay que eximir esta ruta o el registro cae en
// el login y el flujo se rompe entero — el mismo tropiezo que ya documenta /comercio/activar.
export async function accionRegistrarComercio(
  _estadoPrevio: EstadoRegistro,
  formData: FormData,
): Promise<EstadoRegistro> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  // El service client es el único que puede crear la cuenta de Auth y escribir en tablas que están
  // deny-all bajo RLS. Toda la validación vive adentro de crearCuentaAutoservicio.
  const alta = await crearCuentaAutoservicio(createServiceClient(), {
    nombreComercio: String(formData.get('nombre') ?? ''),
    email,
    password,
    plan: String(formData.get('plan') ?? ''),
    tipoTarjeta: String(formData.get('tipo_tarjeta') ?? ''),
  });
  if (!alta.ok) return { error: alta.error };

  // Sesión con las MISMAS credenciales que acaba de elegir. Va con el cliente de servidor (no el de
  // servicio) porque es el que escribe las cookies de sesión.
  const supabase = await createClienteServidor();
  const { error: eSesion } = await supabase.auth.signInWithPassword({ email, password });

  const cookieStore = await cookies();
  revalidatePath('/comercio', 'layout');

  // redirect() funciona LANZANDO NEXT_REDIRECT: las tres llamadas de abajo van fuera de cualquier
  // try/catch o el redirect queda desactivado (regla de la casa, ver CLAUDE.md).
  if (eSesion) {
    // La cuenta SÍ quedó creada: decirle "no se pudo registrar" sería mentirle y lo llevaría a
    // intentar de nuevo con un correo que ahora ya existe. Se lo manda a entrar con lo que eligió.
    console.error('[alta] la cuenta se creó pero no se pudo iniciar sesión:', eSesion.message);
    redirect('/comercio/login?recien=1');
  }

  // Comercio activo = el que acaba de crear. Es el único que tiene, pero fijarlo acá evita que el
  // panel tenga que resolverlo y que la cookie de OTRA sesión en el mismo navegador se cuele.
  cookieStore.set(COOKIE_COMERCIO_ACTIVO, alta.comercioId, opcionesCookieComercio());
  cookieStore.delete(COOKIE_SUCURSAL_ACTIVA);
  redirect('/comercio/panel?bienvenida=1');
}
