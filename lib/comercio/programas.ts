import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { TIPOS, tipoOPuntos } from '../tarjetas/tipos';
import { slugificarNombre } from '../comercios/slugComercio';

// Capa de datos de programas de tarjeta (migración 0024). Un comercio puede tener varios programas
// a la vez — sellos permanente, cupón de campaña — cada uno con su tipo, su configuración y su
// propio slug de registro. Reemplaza el modelo viejo de "un tipo por comercio"
// (lib/comercio/configuracionTipo.ts), que queda para retirar una vez que esta pantalla exista.
//
// Espeja recompensas.ts y sucursales.ts: TODA operación se scopea por comercio_id (del gate, nunca
// del formulario) y la validación vive acá — la BD solo garantiza los CHECK de rango, no las reglas
// de negocio (p. ej. que el tipo tenga su config completa).

export const MAXIMO_PROGRAMAS_ACTIVOS = 2;
// Topes de cordura, no reglas de negocio: atajan el typo, no la decisión comercial. Mismos valores
// que configuracionTipo.ts — no se importan de ahí porque ese módulo se retira en la Tarea 4.
export const MAXIMO_VISITAS_PAQUETE = 500;
export const MAXIMO_DIAS = 3650; // diez años

export interface Programa {
  id: string;
  nombre: string;
  slug: string;
  tipoTarjeta: string;
  esPrincipal: boolean;
  activo: boolean;
  // La meta de sellos vive en el PROGRAMA desde la 0024 y es lo que dibuja la grilla del pase. Viaja
  // acá —y no solo en el módulo de branding— porque las pantallas del dueño (escáner, Clientes,
  // Marca) la necesitan junto al tipo, y leerla de `comercios.sello_meta` mientras `guardarBranding`
  // la escribe en el programa es exactamente cómo se le borraba la meta al principal.
  selloMeta: number | null;
  cashbackPorcentaje: number | null;
  multipassVisitas: number | null;
  membresiaDias: number | null;
  cuponVigenciaDias: number | null;
}

export interface DatosNuevoPrograma {
  nombre: string;
  tipoTarjeta: string;
  cashbackPorcentaje: number | null;
  multipassVisitas: number | null;
  membresiaDias: number | null;
  cuponVigenciaDias: number | null;
}

export interface DatosConfiguracionPrograma {
  cashbackPorcentaje: number | null;
  multipassVisitas: number | null;
  membresiaDias: number | null;
  cuponVigenciaDias: number | null;
}

export type ResultadoPrograma = { ok: true; id: string } | { ok: false; error: string };
export type ResultadoAccion = { ok: true } | { ok: false; error: string };

const CAMPOS_PROGRAMA =
  'id, nombre, slug, tipo_tarjeta, es_principal, activo, sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias';

type FilaPrograma = {
  id: string;
  nombre: string;
  slug: string;
  tipo_tarjeta: string;
  es_principal: boolean;
  activo: boolean;
  sello_meta: number | null;
  cashback_porcentaje: number | string | null;
  multipass_visitas: number | null;
  membresia_dias: number | null;
  cupon_vigencia_dias: number | null;
};

function filaAPrograma(fila: FilaPrograma): Programa {
  return {
    id: fila.id,
    nombre: fila.nombre,
    slug: fila.slug,
    tipoTarjeta: fila.tipo_tarjeta,
    esPrincipal: fila.es_principal,
    activo: fila.activo,
    selloMeta: fila.sello_meta,
    // numeric de Postgres puede llegar como string según el driver: se normaliza acá para que nadie
    // más tenga que acordarse.
    cashbackPorcentaje: fila.cashback_porcentaje === null ? null : Number(fila.cashback_porcentaje),
    multipassVisitas: fila.multipass_visitas,
    membresiaDias: fila.membresia_dias,
    cuponVigenciaDias: fila.cupon_vigencia_dias,
  };
}

// Valida SOLO el campo que le corresponde al tipo del programa — mismo criterio que
// configuracionTipo.ts: validar los demás rechazaría configuración vieja que ya no aplica pero que
// tampoco hace daño, porque ningún motor la lee.
function validarConfiguracion(tipoTarjeta: string, datos: DatosConfiguracionPrograma): string | null {
  const tipo = tipoOPuntos(tipoTarjeta);

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

// Todos los programas del comercio, principal primero. `soloActivos: false` es lo que usa la
// pantalla de administración para que el dueño vea también los que desactivó — el resto de los
// llamadores (registro, escáner, el conteo del límite) quiere solo los vivos, así que es el default.
export async function listarProgramas(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  opciones: { soloActivos?: boolean } = {},
): Promise<Programa[] | null> {
  let query = supabase
    .from('programas_tarjeta')
    .select(CAMPOS_PROGRAMA)
    .eq('comercio_id', comercioId)
    .order('es_principal', { ascending: false })
    .order('created_at', { ascending: true });

  if (opciones.soloActivos !== false) {
    query = query.eq('activo', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[comercio] no se pudo listar los programas:', error);
    return null;
  }
  return data.map(filaAPrograma);
}

// Slug LIBRE dentro del comercio: el base (slugificarNombre) o base-2..base-5. Mismo patrón que
// generarSlugUnico (slugComercio.ts), pero la unicidad de programas_tarjeta es (comercio_id, slug),
// no global — dos comercios pueden tener los dos un programa "principal".
//
// PRECONDICIÓN: `supabase` DEBE ser createServiceClient(). programas_tarjeta queda RLS deny-all sin
// políticas (migración 0024): con un cliente de sesión cada select de acá devuelve data:null y
// error:null —indistinguible de "el slug está libre"— y la pre-verificación sería un no-op
// silencioso. Mismo peligro que ya documenta slugComercio.ts.
async function generarSlugUnicoPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  nombre: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const base = slugificarNombre(nombre);
  for (let i = 1; i <= 5; i++) {
    const candidato = i === 1 ? base : `${base}-${i}`;
    const { data, error } = await supabase
      .from('programas_tarjeta')
      .select('id')
      .eq('comercio_id', comercioId)
      .eq('slug', candidato)
      .maybeSingle();
    if (error) {
      console.error('[comercio] no se pudo verificar la disponibilidad del slug de programa:', error);
      return { ok: false, error: 'No se pudo crear el programa.' };
    }
    if (!data) return { ok: true, slug: candidato };
  }
  return { ok: false, error: 'No se pudo generar una dirección única, cambiá el nombre.' };
}

// El programa principal que necesita TODO comercio nuevo — sin él, registrarCliente no puede
// resolver ningún programa y el alta de clientes queda rota desde el primer minuto (hallazgo real:
// los comercios creados entre que se aplicó la 0024 y que se cableó esta función se quedaron sin
// ninguno — ver la migración 0025). Se llama UNA vez, desde crearComercio (guardarComercio.ts) —
// NUNCA desde crearPrograma de abajo, que es para programas ADICIONALES y siempre valida el tope.
export async function crearProgramaPrincipal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  nombre: string,
  tipoTarjeta: string,
): Promise<ResultadoPrograma> {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .insert({ comercio_id: comercioId, nombre, slug: 'principal', tipo_tarjeta: tipoTarjeta, es_principal: true })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] no se pudo crear el programa principal:', error);
    return { ok: false, error: 'No se pudo crear el programa principal.' };
  }
  return { ok: true, id: data.id };
}

// Crea un programa ADICIONAL — nunca principal (es_principal nace en false siempre: el principal
// de cada comercio nace en crearComercio, vía crearProgramaPrincipal de arriba).
//
// El tope de 2 activos se verifica con un select-then-insert, no con un lock. A diferencia de
// acreditar/ajustar (cajero, alta frecuencia, adversarial — ver el plan de Tanda 1), crear un
// programa es una acción del DUEÑO, rarísima (unas pocas veces en la vida del comercio), y si dos
// pestañas del dueño chocaran exactamente a la vez el peor caso es terminar con 3 programas activos
// en vez de 2 — inofensivo y autocorregible desactivando uno. Mismo criterio que crearSucursal
// (lib/comercio/sucursales.ts) para el cupo de sucursales por plan.
export async function crearPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  datos: DatosNuevoPrograma,
): Promise<ResultadoPrograma> {
  const nombre = datos.nombre.trim();
  if (!nombre) return { ok: false, error: 'El nombre del programa es obligatorio.' };

  if (!TIPOS.some((t) => t.valor === datos.tipoTarjeta)) {
    return { ok: false, error: 'El tipo de tarjeta no es válido.' };
  }

  const problema = validarConfiguracion(datos.tipoTarjeta, datos);
  if (problema) return { ok: false, error: problema };

  const { count, error: errorConteo } = await supabase
    .from('programas_tarjeta')
    .select('id', { count: 'exact', head: true })
    .eq('comercio_id', comercioId)
    .eq('activo', true);
  if (errorConteo) {
    console.error('[comercio] no se pudo contar los programas activos:', errorConteo);
    return { ok: false, error: 'No se pudo crear el programa.' };
  }
  if ((count ?? 0) >= MAXIMO_PROGRAMAS_ACTIVOS) {
    return {
      ok: false,
      error: `Ya tenés ${MAXIMO_PROGRAMAS_ACTIVOS} programas activos. Desactivá uno antes de crear otro.`,
    };
  }

  const slug = await generarSlugUnicoPrograma(supabase, comercioId, nombre);
  if (!slug.ok) return slug;

  const { data, error } = await supabase
    .from('programas_tarjeta')
    .insert({
      comercio_id: comercioId,
      nombre,
      slug: slug.slug,
      tipo_tarjeta: datos.tipoTarjeta,
      es_principal: false,
      cashback_porcentaje: datos.cashbackPorcentaje,
      multipass_visitas: datos.multipassVisitas,
      membresia_dias: datos.membresiaDias,
      cupon_vigencia_dias: datos.cuponVigenciaDias,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[comercio] falló el insert de programa:', error);
    return { ok: false, error: 'No se pudo crear el programa.' };
  }
  return { ok: true, id: data.id };
}

// Guarda la configuración propia del tipo de un programa YA CREADO. El tipo mismo no se puede
// cambiar acá a propósito: un programa con tarjetas emitidas que cambiara de 'cashback' a 'sellos'
// dejaría saldos en centavos leídos como sellos — se lee de la fila, nunca del formulario.
export async function guardarConfiguracionPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
  datos: DatosConfiguracionPrograma,
): Promise<ResultadoAccion> {
  const { data: actual, error: errorLectura } = await supabase
    .from('programas_tarjeta')
    .select('tipo_tarjeta')
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (errorLectura || !actual) {
    console.error('[comercio] no se pudo leer el programa a configurar:', errorLectura);
    return { ok: false, error: 'No se pudo leer el programa.' };
  }

  const problema = validarConfiguracion(actual.tipo_tarjeta, datos);
  if (problema) return { ok: false, error: problema };

  const { error } = await supabase
    .from('programas_tarjeta')
    .update({
      cashback_porcentaje: datos.cashbackPorcentaje,
      multipass_visitas: datos.multipassVisitas,
      membresia_dias: datos.membresiaDias,
      cupon_vigencia_dias: datos.cuponVigenciaDias,
    })
    .eq('id', programaId)
    .eq('comercio_id', comercioId);

  if (error) {
    console.error('[comercio] no se pudo guardar la configuración del programa:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }
  return { ok: true };
}

// Soft-delete — update({activo:false}), NUNCA .delete(): las tarjetas emitidas referencian el
// programa y el historial de cada cliente cuelga de él (mismo criterio que recompensas y cajeros).
//
// El filtro es_principal=false va DENTRO del update, no en un chequeo previo: así "es principal" y
// "ya no existe" quedan protegidos por la MISMA sentencia atómica, sin ventana entre leer y escribir
// en la que otro request pudiera colarse.
export async function desactivarPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<ResultadoAccion> {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .update({ activo: false })
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .eq('es_principal', false)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[comercio] falló la desactivación de programa:', error);
    return { ok: false, error: 'No se pudo desactivar el programa.' };
  }
  if (!data) {
    return { ok: false, error: 'Ese programa no existe, o es el principal y no se puede desactivar.' };
  }
  return { ok: true };
}

// El programa que le corresponde a un registro. `slug` viene de la URL (/registro/<comercio>/<slug>)
// y puede ser null: los QR ya impresos apuntan a /registro/<comercio> sin programa, y ese caso
// resuelve al principal — así siguen funcionando sin reimprimirse.
export async function resolverProgramaPorSlug(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  slug: string | null,
): Promise<Programa | null> {
  let query = supabase
    .from('programas_tarjeta')
    .select(CAMPOS_PROGRAMA)
    .eq('comercio_id', comercioId)
    .eq('activo', true);

  query = slug ? query.eq('slug', slug) : query.eq('es_principal', true);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return filaAPrograma(data);
}

// Lookup directo por id, para cuando ya se tiene el programa_id de una tarjeta (el escáner, Tarea
// 3). Se scopea por comercio_id igual que el resto del módulo, aunque en ese llamador el id ya venga
// de una tarjeta previamente verificada del mismo comercio — es más simple mantener "todo scopeado
// siempre" que recordar cuáles lecturas son "internas" y cuáles no.
export async function obtenerPrograma(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string,
): Promise<Programa | null> {
  const { data, error } = await supabase
    .from('programas_tarjeta')
    .select(CAMPOS_PROGRAMA)
    .eq('id', programaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  if (error || !data) return null;
  return filaAPrograma(data);
}

// El programa de una tarjeta YA ESCANEADA — el escáner lo usa para saber qué mecánica corresponde
// (antes leía comercios.tipo_tarjeta; desde la 0024, cada tarjeta cuelga de un programa propio).
// Dos consultas simples en vez de un embed: mismo estilo que el resto del módulo, y este no es un
// camino de alta frecuencia como para justificar la complejidad de un join.
export async function resolverProgramaDeTarjeta(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tarjetaId: string,
): Promise<Programa | null> {
  const { data: tarjeta, error } = await supabase
    .from('tarjetas')
    .select('programa_id')
    .eq('id', tarjetaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();
  if (error || !tarjeta) return null;
  return obtenerPrograma(supabase, comercioId, tarjeta.programa_id);
}

// Convierte lo que llega del formulario. Cadena vacía ⇒ null. Mismo criterio que
// configuracionDesdeFormulario (configuracionTipo.ts).
export function configuracionProgramaDesdeFormulario(campos: {
  cashbackPorcentaje: string;
  multipassVisitas: string;
  membresiaDias: string;
  cuponVigenciaDias: string;
}): DatosConfiguracionPrograma {
  const aNumero = (valor: string): number | null => {
    const limpio = valor.trim().replace(',', '.');
    if (!limpio) return null;
    // Number() y no parseInt/parseFloat: parseInt('5x') da 5 y se tragaría un typo en silencio.
    const n = Number(limpio);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  return {
    cashbackPorcentaje: aNumero(campos.cashbackPorcentaje),
    multipassVisitas: aNumero(campos.multipassVisitas),
    membresiaDias: aNumero(campos.membresiaDias),
    cuponVigenciaDias: aNumero(campos.cuponVigenciaDias),
  };
}

export interface TarjetaElegible {
  id: string;
  tipoTarjeta: string;
  usadoEn: string | null; // solo relevante para tipo 'cupon'
}

// Tarjetas de un comercio cuyo programa sigue activo — compartida entre la campaña manual
// (lib/comercio/difusiones.ts) y el aviso de inactividad (lib/comercio/avisoInactividad.ts).
// `programaId: null` trae las de TODOS los programas activos; con un id, solo las de ese uno.
export async function tarjetasActivasDelComercio(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  programaId: string | null,
): Promise<TarjetaElegible[]> {
  let query = supabase
    .from('programas_tarjeta')
    .select('id, tipo_tarjeta')
    .eq('comercio_id', comercioId)
    .eq('activo', true);
  if (programaId) query = query.eq('id', programaId);

  const { data: programas, error: errorProgramas } = await query;
  if (errorProgramas) {
    console.error('[comercio] no se pudieron leer los programas activos:', errorProgramas);
    return [];
  }
  if (!programas || programas.length === 0) return [];

  const tipoPorPrograma = new Map(programas.map((p) => [p.id, p.tipo_tarjeta]));
  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    .select('id, programa_id, usado_en')
    .eq('comercio_id', comercioId)
    .in('programa_id', programas.map((p) => p.id));
  if (errorTarjetas) {
    console.error('[comercio] no se pudieron leer las tarjetas activas:', errorTarjetas);
    return [];
  }

  return (tarjetas ?? []).map((t) => ({
    id: t.id,
    tipoTarjeta: tipoPorPrograma.get(t.programa_id) ?? 'puntos',
    usadoEn: t.usado_en,
  }));
}
