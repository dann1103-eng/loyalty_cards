import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from './validarColorRgb';

export interface DatosComercio {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string | null;
  strip_url: string | null;
  hero_url: string | null;
  licencia_estado: string;
  licencia_plan: string | null;
  licencia_monto_mensual: number | null;
  licencia_activa_desde: string | null;
}

export type ResultadoGuardar =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Un opcional vacío es null, no ''. El formulario HTML de la Tarea 9 manda siempre string:
// un campo que el usuario dejó en blanco llega como '', y guardarlo tal cual metería cadenas
// vacías donde la columna espera NULL.
function limpiarOpcional(valor: string | null): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

// Normaliza ANTES de validar para que se valide EXACTAMENTE lo que se almacena. Sin esto,
// validarColorRgb —que hace su propio .trim() interno— aprobaría '  rgb(0,0,0)  ' y el valor
// se guardaría con los espacios puestos.
function normalizar(datos: DatosComercio): DatosComercio {
  return {
    ...datos,
    nombre: datos.nombre.trim(),
    slug: datos.slug.trim(),
    color_fondo: datos.color_fondo.trim(),
    color_texto: datos.color_texto.trim(),
    color_label: datos.color_label.trim(),
    logo_url: limpiarOpcional(datos.logo_url),
    strip_url: limpiarOpcional(datos.strip_url),
    hero_url: limpiarOpcional(datos.hero_url),
    licencia_plan: limpiarOpcional(datos.licencia_plan),
    licencia_activa_desde: limpiarOpcional(datos.licencia_activa_desde),
  };
}

// Devuelve el primer problema encontrado, o null si todo está bien.
// TODA la validación vive aquí, no en los Server Actions: esta es la capa con tests de
// integración. Una regla que solo exista en la acción no está cubierta por ninguna prueba.
function validar(datos: DatosComercio): string | null {
  if (!datos.nombre) return 'El nombre es obligatorio.';
  if (!/^[a-z0-9-]+$/.test(datos.slug)) {
    return 'El slug solo puede tener minúsculas, números y guiones.';
  }
  const colores: [string, string][] = [
    ['color de fondo', datos.color_fondo],
    ['color de texto', datos.color_texto],
    ['color de etiqueta', datos.color_label],
  ];
  for (const [nombre, valor] of colores) {
    if (!validarColorRgb(valor)) {
      return `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.`;
    }
  }
  const monto = datos.licencia_monto_mensual;
  if (monto !== null && (!Number.isFinite(monto) || monto < 0)) {
    return 'El monto mensual debe ser un número positivo.';
  }
  return null;
}

export async function crearComercio(
  supabase: SupabaseClient<Database>,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  const { data, error } = await supabase.from('comercios').insert(limpios).select('id').single();

  if (error) {
    // 23505 = unique violation. El único unique aquí es el slug.
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe un comercio con el slug "${limpios.slug}".` };
    }
    console.error('[fm] falló el insert de comercio:', error);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  return { ok: true, id: data.id };
}

export async function actualizarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase.from('comercios').update(limpios).eq('id', id);

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe otro comercio con el slug "${limpios.slug}".` };
    }
    console.error('[fm] falló el update de comercio:', error);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }

  return { ok: true, id };
}
