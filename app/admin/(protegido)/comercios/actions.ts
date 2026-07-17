'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import {
  crearComercio,
  actualizarComercio,
  eliminarComercio,
  type DatosComercio,
} from '@/lib/comercios/guardarComercio';

export type EstadoFormulario = { error: string } | undefined;

function textoONull(valor: FormDataEntryValue | null): string | null {
  const s = String(valor ?? '').trim();
  return s === '' ? null : s;
}

function leerDatos(formData: FormData): DatosComercio {
  const monto = textoONull(formData.get('licencia_monto_mensual'));
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim(),
    color_fondo: String(formData.get('color_fondo') ?? '').trim(),
    color_texto: String(formData.get('color_texto') ?? '').trim(),
    color_label: String(formData.get('color_label') ?? '').trim(),
    logo_url: textoONull(formData.get('logo_url')),
    strip_url: textoONull(formData.get('strip_url')),
    hero_url: textoONull(formData.get('hero_url')),
    licencia_estado: String(formData.get('licencia_estado') ?? 'activo'),
    licencia_plan: textoONull(formData.get('licencia_plan')),
    // Number('25a') es NaN, no una excepción. No lo atajamos aquí: validar() lo rechaza con
    // "El monto mensual debe ser un número", y esa capa sí tiene pruebas.
    licencia_monto_mensual: monto === null ? null : Number(monto),
    licencia_activa_desde: textoONull(formData.get('licencia_activa_desde')),
    tipo_tarjeta: String(formData.get('tipo_tarjeta') ?? 'puntos'),
  };
}

// Las acciones NO validan: toda la validación vive en validar(), dentro de guardarComercio.ts,
// que es la capa con tests de integración. Aquí solo: autenticar, parsear, delegar.
export async function accionCrearComercio(
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  // Cada Server Action verifica por su cuenta: son POST a la ruta donde se usan, no rutas
  // propias, y los docs de Next dicen explícitamente que no hay que confiar solo en el Proxy.
  // OJO: verifyFmAdmin() usa redirect(), que funciona LANZANDO. Nunca lo envuelvas en try/catch.
  await verifyFmAdmin();

  const res = await crearComercio(createServiceClient(), leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}

export async function accionActualizarComercio(
  id: string,
  _estadoPrevio: EstadoFormulario,
  formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await actualizarComercio(createServiceClient(), id, leerDatos(formData));
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}

export async function accionEliminarComercio(
  id: string,
  _estadoPrevio: EstadoFormulario,
  _formData: FormData,
): Promise<EstadoFormulario> {
  await verifyFmAdmin();

  const res = await eliminarComercio(createServiceClient(), id);
  if (!res.ok) return { error: res.error };

  revalidatePath('/admin/comercios');
  redirect('/admin/comercios');
}
