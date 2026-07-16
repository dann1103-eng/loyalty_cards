import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { esAdminFm } from './esAdminFm';

// Gate de /admin. Se llama desde el layout, CADA página y CADA Server Action.
//
// Por qué no basta el layout: los layouts no se re-renderizan en navegación del lado del
// cliente (Partial Rendering), así que una sesión vencida no se detectaría al cambiar de
// página. Y los Server Actions son POST a la ruta donde se usan — los docs de Next dicen
// explícitamente que hay que verificar auth dentro de cada acción, no confiar en el Proxy.
//
// cache() lo memoiza por render pass, así que layout y página comparten una sola consulta. Un
// Server Action corre fuera de ese render pass y probablemente hará la suya: no pasa nada,
// cache() sin dispatcher simplemente ejecuta la función.
//
// OJO: redirect() funciona LANZANDO una excepción (NEXT_REDIRECT). Si envuelves una llamada a
// verifyFmAdmin() en try/catch y te tragas el error, DESACTIVAS el gate — la ejecución sigue
// como si el usuario estuviera autorizado. Llámalo siempre FUERA de cualquier try/catch.
export const verifyFmAdmin = cache(async () => {
  const supabase = await createClienteServidor();

  // getClaims(), NO getSession(): getSession() no garantiza revalidar el token en servidor.
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    // A diferencia de esAdminFm, aquí un error NO siempre es infraestructura: un JWT vencido da
    // AuthInvalidJwtError y es rutina. Pero AuthRetryableFetchError (Auth caído, red) aterriza
    // en el mismo sitio, y sin este log una caída total se vería idéntica a "no hay sesión".
    // warn y no error porque desde aquí no podemos distinguir cuál de los dos fue.
    console.warn('[fm] getClaims() falló; se trata como sesión ausente:', error);
  }

  const authUserId = data?.claims?.sub;

  if (!authUserId) {
    redirect('/admin/login');
  }

  // La consulta va con el service client: usuarios_fm es deny-all bajo RLS.
  const esAdmin = await esAdminFm(createServiceClient(), authUserId);
  if (!esAdmin) {
    redirect('/admin/login?error=sin-permiso');
  }

  return { authUserId };
});
