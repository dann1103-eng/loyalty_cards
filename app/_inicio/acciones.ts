'use server';

import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import { obtenerIp } from '@/lib/portal/obtenerIp';
import { verificarYRegistrarIntento } from '@/lib/portal/limiteIntentos';
import { guardarProspecto } from '@/lib/prospectos/guardarProspecto';
import { CAMPO_TRAMPA } from './campos';

// Prefijo del cubo del límite de intentos. La tabla `intentos_consulta_portal` se comparte con la
// consulta del portal, pero el cupo NO: sin el prefijo, un cliente que buscó su tarjeta diez veces
// dejaría al dueño de un comercio sin poder pedir una demo desde la misma conexión. La columna es
// `text` y ya se usa con valores que no son IPs (las pruebas), así que esto no fuerza nada.
const CUBO = 'demo:';

export type EstadoDemo = { ok: true } | { error: string } | undefined;

export async function enviarSolicitudDemo(
  _estadoPrevio: EstadoDemo,
  formData: FormData,
): Promise<EstadoDemo> {
  const supabase = createServiceClient();

  // El límite va ANTES de tocar la tabla: un formulario público sin freno es una invitación a
  // llenar la lista de clientes potenciales de basura. Registra el intento salga como salga.
  const ip = obtenerIp(await headers());
  const permitido = await verificarYRegistrarIntento(supabase, `${CUBO}${ip}`);
  if (!permitido) {
    return { error: 'Recibimos varios envíos desde esta conexión. Probá de nuevo en un rato.' };
  }

  const texto = (campo: string) => String(formData.get(campo) ?? '');

  const resultado = await guardarProspecto(supabase, {
    nombre: texto('nombre'),
    negocio: texto('negocio'),
    correo: texto('correo'),
    telefono: texto('telefono'),
    mensaje: texto('mensaje'),
    origen: texto('origen'),
    trampa: texto(CAMPO_TRAMPA),
  });

  // Un envío que cayó en la trampa llega hasta acá como `ok` sin fila guardada, y desde afuera se
  // ve idéntico a uno bueno. Es a propósito: decirle al bot que lo detectamos es enseñarle a pasar.
  if (!resultado.ok) return { error: resultado.error };
  return { ok: true };
}
