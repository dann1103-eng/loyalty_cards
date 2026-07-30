import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { DatosPass } from './generatePass';
import { construirReverso, resolverAviso } from './construirReverso';
import { listarUbicacionesGeopush } from '../comercio/geopush';

export async function datosPassDeTarjeta(
  supabase: SupabaseClient<Database>,
  serialNumber: string,
): Promise<{ datos: DatosPass; authTokenAlmacenado: string } | null> {
  // Sin esta guarda, un NEXT_PUBLIC_BASE_URL ausente produce "undefined/api/apple"
  // y un error críptico de validación (Joi) recién al firmar el pass.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_BASE_URL no está configurada — requerida para el webServiceURL del pass');
  }

  // clientes(nombre) para el campo de la tarjeta: el pass muestra a QUIÉN pertenece, igual que una
  // tarjeta de socio física. Sin join no habría forma de saberlo desde acá.
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select('*, comercios(*), clientes(nombre)')
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  if (!tarjeta || !tarjeta.comercios || !tarjeta.apple_auth_token) return null;

  // Reglas y recompensas para la sección automática del reverso. BEST-EFFORT: si fallan, el pass
  // sale SIN esa sección en vez de no salir. Un cliente con un reverso incompleto está
  // infinitamente mejor que uno sin tarjeta — un throw acá devuelve 401/500 y se queda sin nada.
  // Por eso se avisa por consola y se sigue con arreglos vacíos, sin relanzar.
  //
  // Las dos consultas van en paralelo: son independientes entre sí y este código corre en el
  // camino de emisión de CADA pass (registro, acreditación, refresco de Wallet).
  const [reglas, recompensas, ubicaciones] = await Promise.all([
    // Todas las filas, sin filtrar por tipo: construirReverso elige la vigente de cada tipo (la de
    // activa_desde mayor) porque reglas_puntos no tiene unique y admite duplicados.
    supabase
      .from('reglas_puntos')
      .select('tipo, valor, activa_desde')
      .eq('comercio_id', tarjeta.comercio_id),
    // El `.eq('activa', true)` y el `.order(...)` van acá y NO en construirReverso: esa función es
    // pura y ni siquiera recibe el campo `activa`. Sin el .order(), PostgREST devuelve el orden
    // FÍSICO de la tabla, que cambia cada vez que desactivarRecompensa reescribe una fila: el
    // reverso saldría con las recompensas en distinto orden de una emisión a otra y nada lo
    // detectaría.
    supabase
      .from('recompensas')
      .select('nombre, descripcion, costo_puntos')
      .eq('comercio_id', tarjeta.comercio_id)
      .eq('activa', true)
      .order('costo_puntos', { ascending: true }),
    // Ubicaciones del geopush (0016). Mismo criterio best-effort: listarUbicacionesGeopush ya
    // devuelve [] ante un error, así que un fallo acá emite el pass SIN aviso por cercanía en vez
    // de dejar al cliente sin tarjeta.
    listarUbicacionesGeopush(supabase, tarjeta.comercio_id),
  ]);
  if (reglas.error) {
    console.warn('[apple] no se pudieron leer las reglas para el reverso:', reglas.error.message);
  }
  if (recompensas.error) {
    console.warn('[apple] no se pudieron leer las recompensas para el reverso:', recompensas.error.message);
  }

  const hoyIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  // UTC acá, no la zona del comercio: a diferencia de una campaña de geopush (que vive en
  // sucursales y ya resuelve con la zona del comercio en listarUbicacionesGeopush), este aviso es
  // un campo de LA TARJETA sin zona horaria propia asociada, y el borde de un día de diferencia
  // en el peor caso es "el aviso se ve un día de más/de menos" — no vale la pena la consulta
  // extra a comercios.zona_horaria solo para esto. Si en el futuro importa más precisión, seguir
  // el mismo patrón que listarUbicacionesGeopush.

  return {
    authTokenAlmacenado: tarjeta.apple_auth_token,
    datos: {
      serialNumber,
      qrToken: tarjeta.qr_token,
      puntos: tarjeta.puntos_actuales,
      nombreComercio: tarjeta.comercios.nombre,
      // Puede faltar si el join falla o la fila del cliente se borró: el pass se genera igual, solo
      // sin el campo del titular (generatePass lo omite si viene null).
      nombreCliente: tarjeta.clientes?.nombre ?? null,
      colorFondo: tarjeta.comercios.color_fondo ?? 'rgb(35, 24, 18)',
      colorTexto: tarjeta.comercios.color_texto ?? 'rgb(255, 255, 255)',
      colorLabel: tarjeta.comercios.color_label ?? 'rgb(255, 255, 255)',
      tipoTarjeta: tarjeta.comercios.tipo_tarjeta,
      selloMeta: tarjeta.comercios.sello_meta,
      stripUrl: tarjeta.comercios.strip_url,
      selloIconoUrl: tarjeta.comercios.sello_icono_url,
      heroUrl: tarjeta.comercios.hero_url,
      logoUrl: tarjeta.comercios.logo_url,
      difuminadoFranja: tarjeta.comercios.difuminado_franja,
      // El reverso se ARMA en cada generación, nunca se congela una copia: un reverso que promete
      // una recompensa que el dueño ya cambió es una promesa incumplida frente al cliente final.
      reverso: construirReverso({
        nombreComercio: tarjeta.comercios.nombre,
        tipoTarjeta: tarjeta.comercios.tipo_tarjeta,
        selloMeta: tarjeta.comercios.sello_meta,
        mostrarComoFunciona: tarjeta.comercios.mostrar_como_funciona,
        terminosUso: tarjeta.comercios.terminos_uso,
        redInstagram: tarjeta.comercios.red_instagram,
        redFacebook: tarjeta.comercios.red_facebook,
        redWhatsapp: tarjeta.comercios.red_whatsapp,
        sitioWeb: tarjeta.comercios.sitio_web,
        // `?? []` es la mitad del best-effort: con error, `data` viene null y la sección automática
        // simplemente no se emite.
        reglas: reglas.data ?? [],
        recompensas: recompensas.data ?? [],
        avisoTexto: resolverAviso(tarjeta.aviso_texto, tarjeta.aviso_hasta, hoyIso),
      }),
      ubicaciones,
      webServiceURL: `${baseUrl}/api/apple`,
      authenticationToken: tarjeta.apple_auth_token,
    },
  };
}
