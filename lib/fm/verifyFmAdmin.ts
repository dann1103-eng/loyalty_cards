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
// cache() lo memoiza por render pass (layout + página + acción comparten una sola consulta).
export const verifyFmAdmin = cache(async () => {
  const supabase = await createClienteServidor();

  // getClaims(), NO getSession(): getSession() no garantiza revalidar el token en servidor.
  const { data } = await supabase.auth.getClaims();
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
