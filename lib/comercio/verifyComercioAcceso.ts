import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from './membresiasDeUsuario';
import { resolverComercioActivo } from './comercioActivo';
import { resolverSucursalActiva } from './sucursalActiva';
import { obtenerSucursalActiva } from './sucursales';
import { COOKIE_COMERCIO_ACTIVO, COOKIE_SUCURSAL_ACTIVA } from './cookieComercio';

// Gate COMPARTIDO de /comercio: resuelve la sesión + el "comercio activo" y devuelve TODO el
// contexto (rol incluido). verifyComercioOwner() es un wrapper delgado encima que exige rol owner.
//
// Una cuenta puede administrar VARIOS comercios (varias filas owner). El comercio activo se resuelve
// desde la cookie `fm_comercio_activo`, pero esa cookie es INPUT DEL CLIENTE: se revalida SIEMPRE
// contra la lista real de membresías (resolverComercioActivo). Una cookie a un comercio ajeno se
// ignora → se manda a elegir. El comercio_id que se devuelve viene SIEMPRE de la membresía
// verificada, nunca del formulario (spec §4.4: un comercio_id del cliente dejaría a un dueño
// sobrescribir datos de OTRO comercio).
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT. Envolver esto en try/catch y tragarse el error
// DESACTIVA el gate. Llámalo siempre FUERA de cualquier try/catch. getClaims(), NO getSession():
// getSession() no garantiza revalidar el token en servidor. cache() lo memoiza por render pass.
export const verifyComercioAcceso = cache(async () => {
  const supabase = await createClienteServidor();

  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló; se trata como sesión ausente:', error);
  }

  const sub = data?.claims?.sub;
  if (!sub) {
    redirect('/comercio/login');
  }

  // Service client: usuarios_comercio es deny-all bajo RLS.
  const membresias = await membresiasDeUsuario(createServiceClient(), sub);

  const cookieStore = await cookies();
  const r = resolverComercioActivo(membresias, cookieStore.get(COOKIE_COMERCIO_ACTIVO)?.value);

  if (r.tipo === 'sin-acceso') {
    redirect('/comercio/login?error=sin-permiso');
  }
  if (r.tipo === 'elegir') {
    redirect('/comercio/elegir');
  }

  // Contexto de SUCURSAL activa (plan 2026-07-25 §4.4): para el owner, la cookie (input del
  // cliente) revalidada por obtenerSucursalActiva; para el cajero, SIEMPRE la de su membresía —
  // la cookie se ignora (resolverSucursalActiva). Ajena, apagada o inexistente → null = "todas".
  // (Un cajero cuya sucursal fue desactivada queda null acá: el header muestra solo el comercio;
  // el escáner sigue usando sucursalId de la membresía para su propio bloqueo, sin cambios.)
  const resolucion = resolverSucursalActiva(
    r.membresia.rol,
    r.membresia.sucursalId,
    cookieStore.get(COOKIE_SUCURSAL_ACTIVA)?.value,
  );
  const sucursalActiva =
    resolucion.tipo === 'todas'
      ? null
      : await obtenerSucursalActiva(createServiceClient(), resolucion.sucursalId, r.membresia.comercioId);

  return {
    authUserId: sub,
    comercioId: r.membresia.comercioId,
    nombre: r.membresia.nombre,
    rol: r.membresia.rol,
    usuarioComercioId: r.membresia.usuarioComercioId,
    sucursalId: r.membresia.sucursalId,
    sucursalActiva,
    membresias,
  };
});
