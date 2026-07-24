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

export type EstadoFormulario = { error: string } | undefined;

// Las acciones NO validan: toda la validación vive en la capa lib (cuentas.ts), que es la que
// tiene tests de integración. Aquí solo: autenticar, parsear, delegar. Mismo patrón que
// comercios/actions.ts.
function leerDatos(formData: FormData): { nombre: string; limiteNegocios: number } {
  const limiteRaw = String(formData.get('limite_negocios') ?? '').trim();
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    // Number('') es 0 y Number('3a') es NaN; en ambos casos validarDatosCuenta lo rechaza (exige
    // entero ≥ 1). Se mapea '' a NaN para que el vacío no se lea como el número 0.
    limiteNegocios: limiteRaw === '' ? NaN : Number(limiteRaw),
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
