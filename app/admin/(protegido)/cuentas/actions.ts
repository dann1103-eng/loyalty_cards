'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearCuenta,
  actualizarCuenta,
  eliminarCuenta,
  asignarComercioACuenta,
} from '@/lib/comercios/cuentas';
import type { DatosCuenta } from '@/lib/comercios/cuentas';
import { registrarCobro } from '@/lib/comercios/cobros';

export type EstadoFormulario = { error: string } | undefined;

// Las acciones NO validan: toda la validación vive en la capa lib (cuentas.ts), que es la que
// tiene tests de integración. Aquí solo: autenticar, parsear, delegar. Mismo patrón que
// comercios/actions.ts.
function leerDatos(formData: FormData): DatosCuenta {
  const limiteRaw = String(formData.get('limite_negocios') ?? '').trim();
  const montoRaw = String(formData.get('licencia_monto_mensual') ?? '').trim();
  const fechaRaw = String(formData.get('licencia_activa_desde') ?? '').trim();
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    // '' = sin límite (null). Number('3a') es NaN → validarDatosCuenta lo rechaza (no matchea
    // "es null" ni "es entero >= 1", cae en el mensaje de rango).
    limiteNegocios: limiteRaw === '' ? null : Number(limiteRaw),
    plan: String(formData.get('plan') ?? ''),
    licenciaEstado: String(formData.get('licencia_estado') ?? 'activo'),
    licenciaMontoMensual: montoRaw === '' ? null : Number(montoRaw),
    licenciaActivaDesde: fechaRaw === '' ? null : fechaRaw,
  };
}

export async function accionCrearCuenta(
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  // Cada Server Action verifica por su cuenta (son POST a la ruta donde se usan). OJO:
  // verifyFmAdmin() usa redirect(), que funciona LANZANDO. Nunca lo envuelvas en try/catch.
  await verifyFmAdmin();

  const res = await crearCuenta(createServiceClient(), leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/cuentas');
  redirect('/admin/cuentas');
}

export async function accionActualizarCuenta(
  id: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await actualizarCuenta(createServiceClient(), id, leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/cuentas');
  redirect('/admin/cuentas');
}

export async function accionEliminarCuenta(
  id: string,
  _estadoPrevio: EstadoFormulario,
  _formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await eliminarCuenta(createServiceClient(), id);
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/cuentas');
  redirect('/admin/cuentas');
}

export async function accionVincularComercio(
  cuentaId: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const comercioId = String(formData.get('comercio_id') ?? '');
  if (!comercioId) return { error: 'Elegí un negocio para vincular.' };

  // asignarComercioACuenta verifica el límite de ESTA cuenta (excluyendo al propio comercio) antes
  // de mover el cuenta_id: aunque la UI solo muestre el vínculo cuando hay cupo, una carrera podría
  // llenarla en el medio y la capa lib es la que de verdad lo impide.
  const res = await asignarComercioACuenta(createServiceClient(), comercioId, cuentaId);
  if (!res.ok) return { error: res.error };

  revalidatePath(`/admin/cuentas/${cuentaId}`);
  revalidatePath('/admin/cuentas');
  redirect(`/admin/cuentas/${cuentaId}`);
}

export type EstadoCobro = { error: string } | { ok: true } | undefined;

// Registra un cobro de la cuenta. Seguimiento, NO facturación fiscal: el comprobante que ve el
// dueño lo dice en el propio documento (sin personería jurídica no hay DTE).
export async function accionRegistrarCobro(
  cuentaId: string,
  _estadoPrevio: EstadoCobro,
  formData: FormData,
): Promise<EstadoCobro> {
  await verifyFmAdmin();

  const estadoCobro = String(formData.get('estado_cobro') ?? 'pendiente');
  const pagadoEn = String(formData.get('pagado_en') ?? '').trim();

  const res = await registrarCobro(createServiceClient(), cuentaId, {
    periodoDesde: String(formData.get('periodo_desde') ?? ''),
    periodoHasta: String(formData.get('periodo_hasta') ?? ''),
    monto: Number(String(formData.get('monto') ?? '').trim()),
    estado: estadoCobro,
    metodo: String(formData.get('metodo') ?? '') || null,
    nota: String(formData.get('nota') ?? '') || null,
    // Solo viaja si el cobro está pagado: mandarla con otro estado lo rechaza la validación (y el
    // CHECK de la BD), que es lo correcto — una fecha de pago en un cobro pendiente es un dato falso.
    pagadoEn: estadoCobro === 'pagado' ? pagadoEn || null : null,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath(`/admin/cuentas/${cuentaId}`);
  return { ok: true };
}
