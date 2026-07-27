import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

// Los datos que deja un comercio interesado en la página pública (tabla `prospectos`, migración
// 0014). Toda la validación vive acá y no dentro del componente: el formulario es la ÚNICA puerta
// de entrada de clientes nuevos, y una regla que solo exista en el JSX no la cubre ninguna prueba.

// Lo que manda un <form> HTML: siempre strings. Un campo que el visitante dejó en blanco llega
// como '' (no como undefined), por eso todos son string y no `string | undefined`.
export interface EntradaProspecto {
  nombre: string;
  negocio: string;
  correo: string;
  telefono: string;
  mensaje: string;
  // De dónde vino el visitante. Lo pone la página, no la persona; sirve para cuando haya más de
  // una campaña. Vacío = tráfico directo.
  origen: string;
  // Campo TRAMPA (honeypot): invisible para una persona, irresistible para el bot que rellena todo
  // campo de texto que encuentra. Si viene con algo, el envío es basura.
  trampa: string;
}

export type FilaProspecto = Database['public']['Tables']['prospectos']['Insert'];

export type Evaluacion =
  | { estado: 'trampa' }
  | { estado: 'invalido'; error: string }
  | { estado: 'valido'; fila: FilaProspecto };

// Topes de largo. La BD usa `text` (sin límite): sin esto, un bot puede meter megabytes en una
// fila que después alguien tiene que leer a mano.
export const LARGOS_MAXIMOS = {
  nombre: 80,
  negocio: 80,
  correo: 120,
  telefono: 40,
  mensaje: 1000,
  origen: 60,
} as const;

// Cantidad mínima de dígitos de un teléfono utilizable. Los locales salvadoreños tienen 8.
export const MINIMO_DIGITOS_TELEFONO = 8;

// Forma mínima de un correo: algo, arroba, algo, punto, algo. NO comprueba que exista —eso solo lo
// dice mandarle un mensaje—, ataja el dedazo ("juan@gmail" sin .com) que deja al prospecto
// inalcanzable sin que nadie se entere.
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Un opcional en blanco es null, no ''. La columna acepta null a propósito (migración 0014) y una
// cadena vacía haría que `correo is null` no encuentre las filas sin correo.
function opcional(valor: string): string | null {
  const limpio = valor.trim();
  return limpio ? limpio : null;
}

function cuentaDigitos(valor: string): number {
  return (valor.match(/\d/g) ?? []).length;
}

// Devuelve qué hacer con el envío. Función PURA: sin red, sin BD, sin `Date.now()` — todo el
// riesgo del formulario (qué se rechaza, qué se guarda, qué se ignora en silencio) se puede probar
// exhaustivamente acá.
export function evaluarProspecto(entrada: EntradaProspecto): Evaluacion {
  // La trampa se revisa ANTES que cualquier otra regla, y eso es la regla, no el orden casual de
  // los ifs: si un bot deja además el nombre vacío y le respondiéramos "El nombre es obligatorio",
  // le estaríamos enseñando exactamente qué corregir para pasar. Silencio y éxito falso.
  if (entrada.trampa.trim() !== '') return { estado: 'trampa' };

  const nombre = entrada.nombre.trim();
  const negocio = entrada.negocio.trim();
  const correo = opcional(entrada.correo);
  const telefono = opcional(entrada.telefono);
  const mensaje = opcional(entrada.mensaje);
  const origen = opcional(entrada.origen);

  if (!nombre) return { estado: 'invalido', error: 'Escribí tu nombre.' };
  if (nombre.length > LARGOS_MAXIMOS.nombre) {
    return { estado: 'invalido', error: 'Ese nombre es demasiado largo.' };
  }
  if (!negocio) return { estado: 'invalido', error: 'Escribí el nombre de tu negocio.' };
  if (negocio.length > LARGOS_MAXIMOS.negocio) {
    return { estado: 'invalido', error: 'Ese nombre de negocio es demasiado largo.' };
  }

  // LA regla que hace útil a la tabla: un prospecto sin correo NI teléfono es una fila que nadie
  // puede contactar. Las dos columnas son nullable en la BD, así que esto es la única defensa.
  if (!correo && !telefono) {
    return {
      estado: 'invalido',
      error: 'Dejanos un correo o un teléfono para poder responderte.',
    };
  }

  if (correo && correo.length > LARGOS_MAXIMOS.correo) {
    return { estado: 'invalido', error: 'Ese correo es demasiado largo.' };
  }
  if (correo && !FORMA_CORREO.test(correo)) {
    return { estado: 'invalido', error: 'Ese correo no parece válido. Revisalo, por favor.' };
  }
  if (telefono && telefono.length > LARGOS_MAXIMOS.telefono) {
    return { estado: 'invalido', error: 'Ese teléfono es demasiado largo.' };
  }
  // A diferencia de `clientes.telefono`, acá NO se normaliza a +503…: el teléfono de un prospecto
  // no es llave de identidad ni se busca por él, y normalizarTelefono() rechaza cosas legítimas en
  // este contexto (un extranjero, o alguien que deja dos números). Se guarda tal cual lo escribió;
  // solo se exige que tenga dígitos suficientes para ser marcable.
  if (telefono && cuentaDigitos(telefono) < MINIMO_DIGITOS_TELEFONO) {
    return {
      estado: 'invalido',
      error: 'Ese teléfono no parece válido. Escribilo con sus 8 dígitos.',
    };
  }
  if (mensaje && mensaje.length > LARGOS_MAXIMOS.mensaje) {
    return { estado: 'invalido', error: 'El mensaje es muy largo. Contanos lo esencial.' };
  }

  return {
    estado: 'valido',
    fila: {
      nombre,
      negocio,
      correo,
      telefono,
      mensaje,
      // El origen se RECORTA en vez de rechazarse: lo pone la página, no la persona. Perder un
      // cliente potencial por un parámetro de campaña mal armado sería absurdo.
      origen: origen ? origen.slice(0, LARGOS_MAXIMOS.origen) : null,
    },
  };
}

// `guardado: false` con `ok: true` es el caso de la trampa: hacia afuera se responde éxito (el bot
// no aprende nada) pero no se escribió ninguna fila. Quien llama NO debe distinguirlos en la
// interfaz; el dato existe para que las pruebas puedan.
export type ResultadoGuardar =
  | { ok: true; guardado: boolean }
  | { ok: false; error: string };

export async function guardarProspecto(
  supabase: SupabaseClient<Database>,
  entrada: EntradaProspecto,
): Promise<ResultadoGuardar> {
  const evaluacion = evaluarProspecto(entrada);
  if (evaluacion.estado === 'trampa') return { ok: true, guardado: false };
  if (evaluacion.estado === 'invalido') return { ok: false, error: evaluacion.error };

  const { error } = await supabase.from('prospectos').insert(evaluacion.fila);
  if (error) {
    // La tabla tiene RLS deny-all: esto solo puede fallar por una caída o por un cliente sin la
    // llave de servicio. Se registra porque un fallo sistemático significaría perder clientes
    // potenciales en silencio, que es lo más caro que puede pasar en esta página.
    console.error('[inicio] no se pudo guardar el prospecto:', error);
    return { ok: false, error: 'No pudimos guardar tus datos. Probá de nuevo en un momento.' };
  }
  return { ok: true, guardado: true };
}
