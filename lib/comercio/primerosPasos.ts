import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { tipoOPuntos } from '../tarjetas/tipos';
import { unidadPrograma } from '../tarjetas/unidadPrograma';
import { reversoEfectivo } from './brandingEfectivo';

// EL TUTORIAL. Cuatro pasos que llevan a un negocio recién dado de alta desde "tengo una cuenta"
// hasta "mi primer cliente ya tiene su tarjeta".
//
// ══ POR QUÉ SE DERIVA DEL ESTADO Y NO SE GUARDA ══
// Lo obvio sería una columna `tutorial_paso` que cada pantalla actualiza. No se hizo, por dos
// razones que se pagan caro:
//   1. Una casilla guardada MIENTE en cuanto el dueño deshace algo. Si desactiva su único premio,
//      una columna seguiría diciendo "ya cargaste tu premio" y el tutorial lo felicitaría por algo
//      que ya no tiene.
//   2. Obligaría a acordarse de marcarla desde CADA pantalla que afecta el paso — el mismo tipo de
//      acoplamiento que hizo que `sello_meta` se leyera de una tabla y se escribiera en otra.
// Derivarlo de los datos reales no se puede desincronizar: la fuente es la misma que dibuja las
// pantallas.
//
// ══ POR QUÉ LOS PASOS CAMBIAN SEGÚN EL TIPO (2026-09-08) ══
// Hasta esta fecha los cuatro pasos eran una lista FIJA cableada a sellos, y el paso 2 mandaba a
// Reglas. Pero Reglas ESCONDE su formulario cuando el tipo no cuenta enteros ("Tu tarjeta no se
// gana con sellos ni con puntos"), y el `hecho` colgaba de que existiera una fila en
// `reglas_puntos`. O sea que el dueño de una membresía, un cupón, un descuento, una gift card o un
// cashback tenía un paso IMPOSIBLE: la app misma le decía que no lo necesitaba y el tutorial se lo
// seguía pidiendo. Como el panel solo esconde la lista con los cuatro hechos, quedaba clavado en
// "1 de 4" para siempre.
//
// La regla que lo cierra, y que las pruebas fijan: cada paso tiene que llevar a una pantalla que de
// verdad muestre el formulario que ese paso pide PARA ESE TIPO, y su criterio de "hecho" tiene que
// ser configuración que el tipo de verdad necesita — nunca un campo opcional (`nombre_pase`, por
// ejemplo), que dejaría al dueño clavado en "3 de 4" por el mismo motivo.
//
// Los textos hablan en segunda persona y dicen QUÉ gana el dueño con cada paso, no qué le falta:
// una lista de pendientes sin motivo es una lista de reproches.

export interface PasoTutorial {
  clave: string;
  titulo: string;
  detalle: string;
  href: string;
  hecho: boolean;
}

// El paso sin su estado. `pasosParaTipo` devuelve esto —es puro y se prueba sin BD— y
// `primerosPasos` le agrega el `hecho` consultando los datos reales.
export type PasoCatalogo = Omit<PasoTutorial, 'hecho'>;

// ─────────────────────────────────────────────────────────────────────────────
// El catálogo por tipo
// ─────────────────────────────────────────────────────────────────────────────
// El primero y el último son iguales para los ocho tipos: toda tarjeta se ve mejor con la marca de
// su dueño, y toda tarjeta necesita un primer cliente. Lo que cambia es el medio.

const MARCA: PasoCatalogo = {
  clave: 'marca',
  titulo: 'Poné tu logo y tus colores',
  detalle: 'Así la tarjeta que guarda tu cliente se ve tuya, no nuestra.',
  href: '/comercio/branding',
};

const CLIENTE: PasoCatalogo = {
  clave: 'cliente',
  titulo: 'Sumá tu primer cliente',
  detalle: 'Mostrale el código QR de tu local: él solo se registra en su celular.',
  href: '/comercio/programas',
};

const PREMIO: PasoCatalogo = {
  clave: 'premio',
  titulo: 'Cargá tu primer premio',
  detalle: 'Es lo que tus clientes van a querer alcanzar.',
  href: '/comercio/recompensas',
};

// Solo para los tipos que cuentan ENTEROS, que son los únicos a los que Reglas les muestra el
// formulario. La palabra sale de `unidadPrograma` y no de un `if` sobre 'sellos': así el dueño de
// un prepago lee "visitas" y no una moneda que su tarjeta no tiene.
function pasoReglas(tipoTarjeta: string): PasoCatalogo {
  const unidad = unidadPrograma(tipoTarjeta) ?? { plural: 'puntos' };
  return {
    clave: 'reglas',
    titulo: `Definí cómo se ganan los ${unidad.plural}`,
    detalle: 'Por visita o por monto de compra. Lo cambiás cuando quieras.',
    href: '/comercio/reglas',
  };
}

// La configuración por tipo vive en el PROGRAMA desde la 0024, y su pantalla es Programas de
// tarjeta. Cada entrada nombra lo que ESE tipo necesita: sin el plazo no hay membresía que renovar,
// sin el porcentaje no hay cashback que acreditar.
const CONFIGURACION: Record<string, Omit<PasoCatalogo, 'clave' | 'href'>> = {
  prepago: {
    titulo: 'Definí cuántas visitas trae el paquete',
    detalle: 'Es lo que el cliente compra por adelantado y va usando.',
  },
  cashback: {
    titulo: 'Definí tu porcentaje de cashback',
    detalle: 'Qué parte de cada compra le vuelve al cliente como saldo.',
  },
  membresia: {
    titulo: 'Definí cuánto dura la membresía',
    detalle: 'Los días que vale cada renovación. Sin esto no se puede activar ninguna.',
  },
  cupon: {
    titulo: 'Definí cuántos días vale el cupón',
    detalle: 'La fecha de vencimiento se calcula sola desde que el cliente lo recibe.',
  },
  descuento: {
    titulo: 'Cargá tus niveles de descuento',
    detalle: 'Cuánto tiene que gastar el cliente para llegar a cada porcentaje.',
  },
};

function pasoConfiguracion(tipoTarjeta: string): PasoCatalogo {
  const textos = CONFIGURACION[tipoTarjeta] ?? CONFIGURACION.membresia;
  return { clave: 'configuracion', ...textos, href: '/comercio/programas' };
}

// El reverso del pase, que se escribe en el editor de Marca. Es un paso REAL para los tipos que no
// tienen premio que canjear: es lo único que le explica al cliente qué compró y hasta cuándo vale.
const TERMINOS: Record<string, Omit<PasoCatalogo, 'clave' | 'href'>> = {
  gift_card: {
    titulo: 'Escribí los términos de tu tarjeta',
    detalle: 'Dónde se puede usar el saldo y qué pasa si se pierde. Se ven al dorso del pase.',
  },
  membresia: {
    titulo: 'Escribí los términos de tu membresía',
    detalle: 'Qué incluye y cómo se renueva. Es lo que tu socio lee al dorso del pase.',
  },
  cupon: {
    titulo: 'Escribí los términos de tu cupón',
    detalle: 'Qué incluye la oferta y con qué no se combina. Se ven al dorso del pase.',
  },
  descuento: {
    titulo: 'Escribí los términos de tu descuento',
    detalle: 'En qué compras aplica tu porcentaje. Se ven al dorso del pase.',
  },
};

function pasoTerminos(tipoTarjeta: string): PasoCatalogo {
  const textos = TERMINOS[tipoTarjeta] ?? TERMINOS.membresia;
  return { clave: 'terminos', ...textos, href: '/comercio/branding' };
}

// Los cuatro pasos de cada tipo. Se exporta SOLO para que la prueba verifique que los ocho tienen
// entrada propia: sin ese guardián, un tipo nuevo caería en el fallback a 'puntos' y su dueño
// leería un tutorial que habla de otra tarjeta — que es exactamente el defecto que esto cierra.
export const CATALOGO_POR_TIPO: Record<string, readonly PasoCatalogo[]> = {
  puntos: [MARCA, pasoReglas('puntos'), PREMIO, CLIENTE],
  sellos: [MARCA, pasoReglas('sellos'), PREMIO, CLIENTE],
  prepago: [MARCA, pasoConfiguracion('prepago'), PREMIO, CLIENTE],
  cashback: [MARCA, pasoConfiguracion('cashback'), PREMIO, CLIENTE],
  // La gift card SÍ puede canjear (su contador son centavos), pero no tiene configuración propia:
  // el saldo lo carga el cajero. Su paso 2 es el premio y el 3, los términos.
  gift_card: [MARCA, PREMIO, pasoTerminos('gift_card'), CLIENTE],
  // Los tres sin contador no pueden canjear NADA —no hay de dónde descontar—, así que pedirles un
  // premio sería otro paso imposible. En su lugar, los términos: es el dorso que lee su cliente.
  membresia: [MARCA, pasoConfiguracion('membresia'), pasoTerminos('membresia'), CLIENTE],
  cupon: [MARCA, pasoConfiguracion('cupon'), pasoTerminos('cupon'), CLIENTE],
  descuento: [MARCA, pasoConfiguracion('descuento'), pasoTerminos('descuento'), CLIENTE],
};

// El catálogo del tipo, sin estado. Fallback a 'puntos' con el mismo criterio que `tipoOPuntos`:
// una fila vieja o un tipo escrito a mano degrada al comportamiento más simple en vez de dejar el
// panel sin dibujar. Que un tipo NUEVO no se quede ahí lo garantiza la prueba de cobertura.
export function pasosParaTipo(tipoTarjeta: string): PasoCatalogo[] {
  const catalogo = CATALOGO_POR_TIPO[tipoOPuntos(tipoTarjeta).valor] ?? CATALOGO_POR_TIPO.puntos;
  return catalogo.map((paso) => ({ ...paso }));
}

// ─────────────────────────────────────────────────────────────────────────────
// El estado real
// ─────────────────────────────────────────────────────────────────────────────

// ¿Está cargada la configuración que ESTE tipo necesita? Cada tipo mira SU columna del programa
// principal, nunca la del comercio: la 0024 mudó la configuración por tipo a `programas_tarjeta` y
// ya nadie escribe las columnas legadas — leerlas daría por hecho un paso que en producción no lo
// está (y al revés, dejaría clavado al dueño que sí lo cargó por la pantalla de Programas).
function configuracionLista(
  tipoTarjeta: string,
  programa: {
    cashback_porcentaje: number | string | null;
    multipass_visitas: number | null;
    membresia_dias: number | null;
    cupon_vigencia_dias: number | null;
  } | null,
  nivelesDescuento: number,
): boolean {
  if (tipoTarjeta === 'descuento') return nivelesDescuento > 0;
  if (!programa) return false;
  if (tipoTarjeta === 'prepago') return programa.multipass_visitas != null;
  if (tipoTarjeta === 'cashback') return programa.cashback_porcentaje != null;
  if (tipoTarjeta === 'membresia') return programa.membresia_dias != null;
  if (tipoTarjeta === 'cupon') return programa.cupon_vigencia_dias != null;
  return false;
}

// Todos los pasos con su estado real. Las consultas van en paralelo: esto corre en el panel, que es
// la primera pantalla que ve el dueño en cada visita. Y solo se piden las que el tipo necesita —
// una membresía no tiene por qué contar reglas ni premios que su tutorial ni siquiera menciona.
//
// `head: true` + `count: 'exact'` no traen filas: solo hace falta saber si hay al menos una, y un
// comercio con miles de tarjetas no debería pagar el traslado de ninguna.
export async function primerosPasos(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tipoTarjeta: string,
): Promise<PasoTutorial[]> {
  const tipo = tipoOPuntos(tipoTarjeta).valor;
  const catalogo = pasosParaTipo(tipo);
  const claves = new Set(catalogo.map((p) => p.clave));

  const [comercio, programa, reglas, premios, clientes, niveles] = await Promise.all([
    // Las columnas del reverso viajan con el logo porque el paso `terminos` las necesita enteras:
    // `reversoEfectivo` resuelve la herencia sobre el objeto completo, igual que el pase.
    supabase
      .from('comercios')
      .select(
        'logo_url, terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona',
      )
      .eq('id', comercioId)
      .maybeSingle(),
    supabase
      .from('programas_tarjeta')
      .select(
        'cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias, reverso_propio, terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona',
      )
      .eq('comercio_id', comercioId)
      .eq('es_principal', true)
      .maybeSingle(),
    claves.has('reglas')
      ? supabase.from('reglas_puntos').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId)
      : null,
    // SOLO las activas: desactivar el único premio devuelve el paso a pendiente, que es la verdad —
    // el cliente volvió a no tener nada que canjear.
    claves.has('premio')
      ? supabase
          .from('recompensas')
          .select('id', { count: 'exact', head: true })
          .eq('comercio_id', comercioId)
          .eq('activa', true)
      : null,
    supabase.from('tarjetas').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId),
    tipo === 'descuento'
      ? supabase.from('niveles_descuento').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId)
      : null,
  ]);

  // La MISMA herencia que usa el pase (reversoEfectivo): el editor de Marca sin programa
  // seleccionado —el flujo por defecto, porque el selector aparece recién con dos tarjetas— escribe
  // `comercios.terminos_uso`. Leyendo solo la columna del programa, el dueño que ya escribió sus
  // términos quedaría clavado en "3 de 4": el mismo defecto, otra vez.
  const c = comercio.data;
  const dorso = c
    ? reversoEfectivo(
        {
          terminosUso: c.terminos_uso,
          redInstagram: c.red_instagram,
          redFacebook: c.red_facebook,
          redWhatsapp: c.red_whatsapp,
          sitioWeb: c.sitio_web,
          mostrarComoFunciona: c.mostrar_como_funciona,
        },
        programa.data
          ? {
              reversoPropio: programa.data.reverso_propio,
              terminosUso: programa.data.terminos_uso,
              redInstagram: programa.data.red_instagram,
              redFacebook: programa.data.red_facebook,
              redWhatsapp: programa.data.red_whatsapp,
              sitioWeb: programa.data.sitio_web,
              mostrarComoFunciona: programa.data.mostrar_como_funciona,
            }
          : null,
      )
    : null;

  // Ante un error de consulta el paso queda PENDIENTE, no hecho: mostrarle "ya está" a alguien que
  // no lo hizo lo deja sin saber qué le falta, y el panel se dibuja igual.
  const hechos: Record<string, boolean> = {
    marca: Boolean(c?.logo_url),
    reglas: (reglas?.count ?? 0) > 0,
    premio: (premios?.count ?? 0) > 0,
    cliente: (clientes.count ?? 0) > 0,
    configuracion: configuracionLista(tipo, programa.data, niveles?.count ?? 0),
    // `.trim()` y no un `Boolean` a secas: un espacio deja el dorso del pase igual de vacío que
    // antes, así que no puede dar el paso por hecho.
    terminos: (dorso?.terminosUso ?? '').trim().length > 0,
  };

  return catalogo.map((paso) => ({ ...paso, hecho: hechos[paso.clave] ?? false }));
}
