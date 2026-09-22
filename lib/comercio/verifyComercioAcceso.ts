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
import { decidirRedireccion } from './decidirRedireccion';
import { estadoEfectivo, type EstadoCobranza } from '../comercios/cobranza';
import { listarPeriodosPagados } from '../comercios/cobros';
import { hoyEnZona } from '../tarjetas/vigencia';

// Estado de cobranza de la CUENTA que administra un comercio (spec 2026-09-21-cobranza-design.md,
// "Cómo se bloquea"). Migración 0038 (cuentas_comercio.cobranza/cobranza_desde/
// cobranza_pospuesta_hasta) — sin ella esta consulta falla.
//
// `null` cuando no se puede determinar (comercio sin `cuenta_id` todavía, o una falla de lectura):
// se trata como "no bloquear". Mismo criterio que el resto de la cobranza ante un dato que no se
// pudo leer (cargarCuentaParaPagos, listarPeriodosPagados: `null` + log, nunca tumbar la pantalla) —
// bloquear el panel ENTERO por un error de lectura transitorio sería un incidente peor que el que
// esta cobranza intenta evitar. OJO: a diferencia de esos dos (que fallan hacia MÁS restrictivo —
// no ofrecer pagar, cupo en cero), acá la falla es hacia MENOS restrictivo, y `licencia_estado` viaja
// en la MISMA fila/consulta que las columnas de cobranza: una lectura que falla deja pasar temporal-
// mente también a una cuenta que FM cortó a mano (`licencia_estado = 'inactivo'`, el interruptor
// manual de `estadoEfectivo`), no solo a una vencida por no pago. Riesgo aceptado a propósito —ver el
// párrafo de arriba—, pero es la asimetría real: un corte manual explícito puede quedar sin efecto
// por unos segundos/minutos si Supabase falla justo en ese momento, no solo el conteo de días de
// gracia de una cuenta morosa.
//
// cache() por comercioId: el layout (vía verifyComercioAccesoSinBloqueo) y el gate que bloquea (vía
// verifyComercioAcceso) la piden en el MISMO render — sin memoizar, dos consultas idénticas.
const estadoCobranzaDelComercio = cache(async (comercioId: string): Promise<EstadoCobranza | null> => {
  const service = createServiceClient();

  const { data: comercio, error: eComercio } = await service
    .from('comercios')
    .select('cuenta_id')
    .eq('id', comercioId)
    .maybeSingle();
  if (eComercio) console.error('[comercio] no se pudo leer cuenta_id para cobranza:', eComercio);
  if (eComercio || !comercio?.cuenta_id) return null;

  const { data: cuenta, error: eCuenta } = await service
    .from('cuentas_comercio')
    .select('licencia_estado, cobranza, cobranza_desde, cobranza_pospuesta_hasta')
    .eq('id', comercio.cuenta_id)
    .maybeSingle();
  if (eCuenta) console.error('[comercio] no se pudo leer la cuenta para cobranza:', eCuenta);
  if (eCuenta || !cuenta) return null;

  // Exenta no necesita mirar los períodos pagados: estadoDeCobranza corta en el primer `if` sin
  // usarlos (spec, "Costo") — se ahorra la consulta en el camino más común hoy (todas las cuentas
  // existentes quedaron 'exenta' con la migración 0038).
  const periodosPagados =
    cuenta.cobranza === 'exenta' ? [] : await listarPeriodosPagados(service, comercio.cuenta_id);
  if (periodosPagados === null) {
    console.error('[comercio] no se pudieron leer los períodos pagados de la cuenta para cobranza:', comercio.cuenta_id);
    return null;
  }

  return estadoEfectivo({
    cobranza: cuenta.cobranza as 'normal' | 'exenta',
    desde: cuenta.cobranza_desde,
    pospuestaHasta: cuenta.cobranza_pospuesta_hasta,
    periodosPagados,
    hoy: hoyEnZona('America/El_Salvador'),
    licenciaEstado: cuenta.licencia_estado,
  });
});

// Gate COMPARTIDO de /comercio: resuelve la sesión + el "comercio activo" y devuelve TODO el
// contexto (rol incluido), MÁS el estado de cobranza — pero SIN bloquear por cobranza. Existe para
// el layout de (protegido) (dibuja el shell + un banner según el estado) y para las pantallas
// "excepción" que un dueño/cajero bloqueado TODAVÍA necesita ver (plan, resultado de pago,
// comprobante, /comercio/suspendida): un redirect() desde acá los sacaría también a ellas.
// verifyComercioAcceso() (abajo) es esta misma función MÁS el redirect() de bloqueo.
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
export const verifyComercioAccesoSinBloqueo = cache(async () => {
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

  const estadoCobranza = await estadoCobranzaDelComercio(r.membresia.comercioId);

  return {
    authUserId: sub,
    comercioId: r.membresia.comercioId,
    nombre: r.membresia.nombre,
    rol: r.membresia.rol,
    usuarioComercioId: r.membresia.usuarioComercioId,
    sucursalId: r.membresia.sucursalId,
    sucursalActiva,
    membresias,
    estadoCobranza,
  };
});

// Gate que SÍ bloquea (spec 2026-09-21-cobranza-design.md, "Cómo se bloquea"): lo llaman cada página
// y cada Server Action normal del panel y del escáner — las excepciones (layout, /comercio/plan y
// sus 2 páginas hermanas, /comercio/suspendida) usan verifyComercioAccesoSinBloqueo() de arriba.
//
// Mantiene el nombre y la firma de retorno de siempre (es un superset: agrega `estadoCobranza`, no
// quita ni cambia ningún campo existente) para no romper a sus 8 llamadores directos ni a los ~30
// indirectos vía verifyComercioOwner().
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT — el chequeo de cobranza va SIEMPRE fuera de
// cualquier try/catch, mismo criterio que el resto de este gate.
export const verifyComercioAcceso = cache(async () => {
  const acceso = await verifyComercioAccesoSinBloqueo();

  if (acceso.estadoCobranza) {
    // El rol de una membresía está acotado por la BD a 'owner' | 'cajero' (check de la migración
    // 0001) — Membresia.rol lo tipa como `string` porque viene de una consulta genérica, no porque
    // pueda ser otra cosa.
    const destino = decidirRedireccion(acceso.estadoCobranza, acceso.rol as 'owner' | 'cajero');
    if (destino) {
      redirect(destino);
    }
  }

  return acceso;
});
