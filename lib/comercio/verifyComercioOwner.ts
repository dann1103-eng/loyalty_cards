import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { esOwnerDeComercio } from './esOwnerDeComercio';

// Gate de /comercio. Se llama desde el layout, CADA página y CADA Server Action del panel del
// dueño. Mismas razones que verifyFmAdmin(): los layouts no se re-renderizan en navegación del
// lado del cliente, y los Server Actions son POST a su ruta (los docs de Next exigen verificar
// auth dentro de cada acción, no confiar en el Proxy). cache() lo memoiza por render pass.
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT. Envolver esto en try/catch y tragarse el error
// DESACTIVA el gate. Llámalo siempre FUERA de cualquier try/catch.
//
// Devuelve comercioId para que las acciones scopeen SIEMPRE por la sesión verificada — nunca por
// un campo del formulario (spec §4.4 corrección 1: un comercio_id del cliente dejaría a un dueño
// sobrescribir datos de OTRO comercio).
export const verifyComercioOwner = cache(async () => {
  const supabase = await createClienteServidor();

  // getClaims(), NO getSession(): getSession() no garantiza revalidar el token en servidor.
  const { data, error } = await supabase.auth.getClaims();

  if (error) {
    console.warn('[comercio] getClaims() falló; se trata como sesión ausente:', error);
  }

  const authUserId = data?.claims?.sub;

  if (!authUserId) {
    redirect('/comercio/login');
  }

  // Service client: usuarios_comercio es deny-all bajo RLS.
  const owner = await esOwnerDeComercio(createServiceClient(), authUserId);
  if (!owner) {
    redirect('/comercio/login?error=sin-permiso');
  }

  return { authUserId, comercioId: owner.comercioId, nombre: owner.nombre };
});
