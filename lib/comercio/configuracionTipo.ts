import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tipoOPuntos } from '../tarjetas/tipos';

// La configuración propia de cada tipo de tarjeta (migración 0018). Cada campo solo aplica a UN
// tipo, así que la pantalla muestra únicamente el que corresponde al comercio.
//
// Sin esto los motores existen pero nadie puede encenderlos: acreditarCashback no sabe qué
// porcentaje devolver, venderPaquete no sabe cuántas visitas trae, renovarMembresia no sabe cuántos
// días dura.

export interface ConfiguracionTipo {
  tipoTarjeta: string;
  cashbackPorcentaje: number | null;
  multipassVisitas: number | null;
  membresiaDias: number | null;
  cuponVigenciaDias: number | null;
}

export type ResultadoConfiguracion = { ok: true } | { ok: false; error: string };

// Topes de cordura, no reglas de negocio: atajan el typo, no la decisión comercial.
export const MAXIMO_VISITAS_PAQUETE = 500;
export const MAXIMO_DIAS = 3650; // diez años

// Valida SOLO el campo que le corresponde al tipo del comercio. Validar los demás rechazaría
// configuraciones viejas que quedaron de cuando el comercio era de otro tipo, y que son inofensivas
// porque ningún motor las lee.
function validar(datos: ConfiguracionTipo): string | null {
  const tipo = tipoOPuntos(datos.tipoTarjeta);

  if (tipo.valor === 'cashback') {
    const pct = datos.cashbackPorcentaje;
    if (pct === null) return 'Poné qué porcentaje de cada compra vuelve como saldo.';
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return 'El porcentaje de cashback tiene que estar entre 0 y 100.';
    }
  }

  if (tipo.valor === 'prepago') {
    const visitas = datos.multipassVisitas;
    if (visitas === null) return 'Poné cuántas visitas trae el paquete.';
    if (!Number.isInteger(visitas) || visitas <= 0 || visitas > MAXIMO_VISITAS_PAQUETE) {
      return `Las visitas del paquete tienen que ser un número entero entre 1 y ${MAXIMO_VISITAS_PAQUETE}.`;
    }
  }

  if (tipo.valor === 'membresia') {
    const dias = datos.membresiaDias;
    if (dias === null) return 'Poné cuántos días dura cada renovación.';
    if (!Number.isInteger(dias) || dias <= 0 || dias > MAXIMO_DIAS) {
      return `Los días de la membresía tienen que ser un número entero entre 1 y ${MAXIMO_DIAS}.`;
    }
  }

  if (tipo.valor === 'cupon') {
    // Este SÍ puede quedar vacío: null = el cupón no vence nunca, que es una decisión válida.
    const dias = datos.cuponVigenciaDias;
    if (dias !== null && (!Number.isInteger(dias) || dias <= 0 || dias > MAXIMO_DIAS)) {
      return `Los días de vigencia del cupón tienen que ser un número entero entre 1 y ${MAXIMO_DIAS}.`;
    }
  }

  return null;
}

export async function leerConfiguracionTipo(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ConfiguracionTipo | null> {
  const { data, error } = await supabase
    .from('comercios')
    .select('tipo_tarjeta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
    .eq('id', comercioId)
    .maybeSingle();

  if (error || !data) {
    console.error('[configuracion] no se pudo leer la configuración del tipo:', error);
    return null;
  }

  return {
    tipoTarjeta: data.tipo_tarjeta,
    // numeric de Postgres puede llegar como string según el driver: se normaliza acá para que la
    // validación no compare un texto contra un número.
    cashbackPorcentaje: data.cashback_porcentaje === null ? null : Number(data.cashback_porcentaje),
    multipassVisitas: data.multipass_visitas,
    membresiaDias: data.membresia_dias,
    cuponVigenciaDias: data.cupon_vigencia_dias,
  };
}

export async function guardarConfiguracionTipo(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: ConfiguracionTipo,
): Promise<ResultadoConfiguracion> {
  const problema = validar(datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('comercios')
    .update({
      cashback_porcentaje: datos.cashbackPorcentaje,
      multipass_visitas: datos.multipassVisitas,
      membresia_dias: datos.membresiaDias,
      cupon_vigencia_dias: datos.cuponVigenciaDias,
    })
    .eq('id', comercioId);

  if (error) {
    console.error('[configuracion] no se pudo guardar la configuración del tipo:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }
  return { ok: true };
}

// Convierte lo que llega del formulario. Cadena vacía ⇒ null.
export function configuracionDesdeFormulario(
  tipoTarjeta: string,
  campos: {
    cashbackPorcentaje: string;
    multipassVisitas: string;
    membresiaDias: string;
    cuponVigenciaDias: string;
  },
): ConfiguracionTipo {
  const aNumero = (valor: string): number | null => {
    const limpio = valor.trim().replace(',', '.');
    if (!limpio) return null;
    // Number() y no parseInt/parseFloat: parseInt('5x') da 5 y se tragaría un typo en silencio.
    const n = Number(limpio);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  return {
    tipoTarjeta,
    cashbackPorcentaje: aNumero(campos.cashbackPorcentaje),
    multipassVisitas: aNumero(campos.multipassVisitas),
    membresiaDias: aNumero(campos.membresiaDias),
    cuponVigenciaDias: aNumero(campos.cuponVigenciaDias),
  };
}
