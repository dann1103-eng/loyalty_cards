import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { normalizarTelefono } from '../clientes/normalizarTelefono';
import { historialParaCliente, type MovimientoPortal } from './historialCliente';
import { brandingEfectivo } from '../comercio/brandingEfectivo';
import { describirFila, type NivelDeDescuento } from '../tarjetas/estadoTarjeta';
import { hoyEnZona } from '../tarjetas/vigencia';
import { listarNiveles } from '../tarjetas/descuento';

export interface RecompensaPortal {
  nombre: string;
  descripcion: string | null;
  costoPuntos: number;
  fotoUrl: string | null;
}

export interface TarjetaPortal {
  tarjetaId: string;
  comercioNombre: string;
  colorFondo: string | null;
  colorTexto: string | null;
  colorLabel: string | null;
  tipoTarjeta: string;
  puntosActuales: number;
  selloMeta: number | null;
  saldoTexto: string;
  recompensas: RecompensaPortal[];
  // Movimientos recientes con proyección reducida (Tanda 1). Ver lib/portal/historialCliente.ts:
  // NO lleva cajero, motivo, marca de forzada ni monto — eso es interno del comercio.
  movimientos: MovimientoPortal[];
}

export interface ResultadoConsulta {
  encontrado: boolean;
  nombreCliente: string | null;
  tarjetas: TarjetaPortal[];
}

// El saldo se muestra como TEXTO en un solo lugar (spec §2, y §4.2 de la Fase 3: sin grilla
// visual). Ese "un solo lugar" es `describirSaldo` (lib/tarjetas/tipos.ts), al que se llega por
// `describirFila`.
//
// Acá vivía `formatearSaldo(tipo, puntos, selloMeta)`, que solo sabía de sellos y puntos y trataba
// a los otros SEIS tipos como puntos: una gift card de $25.00 le decía "2500 puntos" al cliente, y
// un cupón vencido, "0 puntos". Se retiró en vez de arreglarse porque el defecto estaba en su
// FIRMA —sin la fecha de vigencia ni el acumulado no hay forma de describir cupón, membresía ni
// descuento—, así que arreglarle el cuerpo habría dejado la trampa armada para el próximo llamador.

// Busca al cliente por teléfono y arma sus tarjetas con el comercio (nombre, colores, tipo, saldo)
// y las recompensas ACTIVAS de cada comercio. Solo lectura. Usa createServiceClient() (lo pasa el
// caller): clientes no cuelga de RLS y tarjetas/recompensas son deny-all salvo service_role.
export async function buscarTarjetasPorTelefono(
  supabase: SupabaseClient<Database>,
  telefono: string,
  clavePais?: string,
): Promise<ResultadoConsulta> {
  // Corregido tras revisión de plan: `clientes.telefono` SIEMPRE se guarda normalizado
  // (normalizarTelefono.ts: "7777-1234"/"77771234" -> "+50377771234", ver app/api/registro/
  // route.ts). Un .trim() a secas comparaba el valor CRUDO contra la columna CANÓNICA — un
  // cliente real tecleando su número tal como lo escribió jamás habría encontrado su tarjeta.
  // Sin este fix, la función entera no serviría para nada con datos reales aunque todas las
  // pruebas dieran verde (si insertan y consultan con el mismo string crudo, nunca lo detectan).
  let limpio: string;
  try {
    limpio = normalizarTelefono(telefono, clavePais);
  } catch {
    // Formato irreconocible (ni +503 válido ni 8 dígitos locales): no es un error de
    // infraestructura, es que no hay tarjeta que buscar con eso.
    return { encontrado: false, nombreCliente: null, tarjetas: [] };
  }

  const { data: cliente, error: errorCliente } = await supabase
    .from('clientes')
    .select('id, nombre')
    .eq('telefono', limpio)
    .maybeSingle();

  if (errorCliente) {
    // maybeSingle() devuelve error:null cuando no hay filas: un error aquí es infraestructura.
    console.error('[portal] falló la consulta de cliente:', errorCliente);
    return { encontrado: false, nombreCliente: null, tarjetas: [] };
  }
  if (!cliente) return { encontrado: false, nombreCliente: null, tarjetas: [] };

  // Embed a-uno tarjetas -> comercios (FK tarjetas_comercio_id_fkey, ya en types.ts). Lee
  // tipo_tarjeta y sello_meta, que agrega la migración 0005 de la Fase 3 (prerrequisito).
  const { data: tarjetas, error: errorTarjetas } = await supabase
    .from('tarjetas')
    // programas_tarjeta trae el tipo y la meta REALES (0024); las columnas homónimas de comercios
    // quedaron legadas. Sin este join, el portal le muestra al cliente su tarjeta de cupón como si
    // fuera de sellos — el mismo bug que tenían el pase de Apple y el objeto de Google.
    // vigencia_hasta, usado_en y acumulado_centavos NO son opcionales: sin ellos, describirFila no
    // puede distinguir un cupón vigente de uno vencido ni resolver el nivel de descuento, y el
    // cliente vería "0 puntos" en los tres tipos que no tienen contador.
    .select('id, puntos_actuales, vigencia_hasta, usado_en, acumulado_centavos, programas_tarjeta(tipo_tarjeta, sello_meta, branding_propio, color_fondo, color_texto, color_label), comercios(id, nombre, color_fondo, color_texto, color_label, tipo_tarjeta, sello_meta, zona_horaria)')
    .eq('cliente_id', cliente.id);

  if (errorTarjetas) {
    console.error('[portal] falló la consulta de tarjetas:', errorTarjetas);
    return { encontrado: true, nombreCliente: cliente.nombre, tarjetas: [] };
  }

  const filas = (tarjetas ?? []).filter((t) => t.comercios);
  const comercioIds = filas.map((t) => t.comercios!.id);

  // Recompensas activas de todos los comercios involucrados en UNA sola consulta (.in), luego se
  // agrupan por comercio en memoria. Se evita el embed inverso comercios(recompensas(...)), que
  // exigiría una Relationship que recompensas no declara en types.ts hoy.
  const recompensasPorComercio = new Map<string, RecompensaPortal[]>();
  if (comercioIds.length > 0) {
    const { data: recompensas, error: errorRecompensas } = await supabase
      .from('recompensas')
      .select('comercio_id, nombre, descripcion, costo_puntos, foto_url')
      .in('comercio_id', comercioIds)
      .eq('activa', true)
      .order('costo_puntos');
    if (errorRecompensas) {
      console.error('[portal] falló la consulta de recompensas:', errorRecompensas);
    }
    for (const r of recompensas ?? []) {
      const lista = recompensasPorComercio.get(r.comercio_id) ?? [];
      lista.push({
        nombre: r.nombre,
        descripcion: r.descripcion,
        costoPuntos: r.costo_puntos,
        fotoUrl: r.foto_url,
      });
      recompensasPorComercio.set(r.comercio_id, lista);
    }
  }

  // Los movimientos van por tarjeta (la función SQL toma una sola), así que es una consulta por
  // tarjeta. Se lanzan en paralelo porque un cliente rara vez tiene más de dos o tres, y
  // secuencialmente sumarían latencia visible en una pantalla que se abre desde el teléfono.
  const movimientosPorTarjeta = new Map<string, MovimientoPortal[]>(
    await Promise.all(
      filas.map(async (t): Promise<[string, MovimientoPortal[]]> => [
        t.id,
        await historialParaCliente(supabase, t.comercios!.id, t.id),
      ]),
    ),
  );

  // El tipo de cada tarjeta cuelga del PROGRAMA entero, con las columnas del comercio como fallback
  // legado. Se resuelve una vez acá porque lo necesitan las dos cosas de abajo: saber a qué
  // comercios pedirles los niveles, y describir el saldo.
  const tipoDe = (t: (typeof filas)[number]) =>
    t.programas_tarjeta ? t.programas_tarjeta.tipo_tarjeta : t.comercios!.tipo_tarjeta;

  // Niveles de descuento, SOLO de los comercios que tengan una tarjeta de ese tipo: es una consulta
  // por comercio y casi ninguno usa el tipo. Sin ellos, el portal le diría "Sin descuento todavía"
  // a un cliente que sí llegó a un nivel.
  const nivelesPorComercio = new Map<string, NivelDeDescuento[]>();
  await Promise.all(
    [...new Set(filas.filter((t) => tipoDe(t) === 'descuento').map((t) => t.comercios!.id))].map(
      async (id) => {
        nivelesPorComercio.set(id, (await listarNiveles(supabase, id)) ?? []);
      },
    ),
  );

  const resultado: TarjetaPortal[] = filas.map((t) => {
    const c = t.comercios!;
    // Cuelga del PROGRAMA entero, no de cada campo (ver datosPassDeTarjeta.ts).
    const p = t.programas_tarjeta;
    const tipoTarjeta = tipoDe(t);
    const selloMeta = p ? p.sello_meta : c.sello_meta;
    // Los colores SÍ heredan campo por campo (0027), a diferencia de tipo/meta. El portal solo
    // muestra los tres colores, así que se piden solo esos: las imágenes no se usan acá.
    const marca = brandingEfectivo(
      {
        colorFondo: c.color_fondo,
        colorTexto: c.color_texto,
        colorLabel: c.color_label,
        logoUrl: null,
        heroUrl: null,
        stripUrl: null,
        selloIconoUrl: null,
        difuminadoFranja: 'medio',
      },
      p
        ? {
            brandingPropio: p.branding_propio,
            colorFondo: p.color_fondo,
            colorTexto: p.color_texto,
            colorLabel: p.color_label,
          }
        : null,
    );
    return {
      tarjetaId: t.id,
      comercioNombre: c.nombre,
      colorFondo: marca.colorFondo,
      colorTexto: marca.colorTexto,
      colorLabel: marca.colorLabel,
      tipoTarjeta,
      puntosActuales: t.puntos_actuales,
      selloMeta,
      // La zona del COMERCIO y no la del servidor: "vence el 30" tiene que significar el 30 completo
      // en el local, y en UTC un cupón moriría a las 6 de la tarde del día anterior.
      saldoTexto: describirFila(
        t,
        tipoTarjeta,
        selloMeta,
        nivelesPorComercio.get(c.id) ?? [],
        hoyEnZona(c.zona_horaria),
      ),
      recompensas: recompensasPorComercio.get(c.id) ?? [],
      movimientos: movimientosPorTarjeta.get(t.id) ?? [],
    };
  });

  return { encontrado: true, nombreCliente: cliente.nombre, tarjetas: resultado };
}
