import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { DatosPass } from './generatePass';
import { construirReverso, resolverAviso } from './construirReverso';
import { listarUbicacionesGeopush } from '../comercio/geopush';
import { brandingEfectivo, reversoEfectivo } from '../comercio/brandingEfectivo';

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
  // programas_tarjeta NO es opcional: desde la 0024 el tipo y su configuración viven en el PROGRAMA
  // y comercios.tipo_tarjeta/sello_meta quedaron LEGADAS. Sin este join, la tarjeta de un programa
  // secundario se dibujaba con el tipo del comercio — un cupón se le instalaba al cliente como
  // tarjeta de sellos mientras el escáner la operaba como cupón.
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    .select(
      '*, comercios(*), clientes(nombre), programas_tarjeta(tipo_tarjeta, sello_meta, branding_propio, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, reverso_propio, terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona)',
    )
    .eq('apple_serial_number', serialNumber)
    .maybeSingle();

  if (!tarjeta || !tarjeta.comercios || !tarjeta.apple_auth_token) return null;

  // Fallback a las columnas legadas solo si el join no trajo programa (no debería: programa_id es
  // NOT NULL desde la 0024). Se avisa por consola en vez de degradar en silencio: un pase dibujado
  // con el tipo equivocado es exactamente el bug que este join vino a cerrar.
  //
  // El condicional cuelga del PROGRAMA entero, no de cada campo: con `?? comercio.sello_meta`, un
  // programa de cupón (sello_meta null LEGÍTIMAMENTE) heredaría la meta de sellos del comercio y
  // el pase volvería a dibujar una grilla. `null` acá es un valor válido, no un valor ausente.
  const programa = tarjeta.programas_tarjeta;
  if (!programa) {
    console.error(`[apple] la tarjeta ${tarjeta.id} no tiene programa; se usa el tipo legado del comercio`);
  }
  const tipoTarjeta = programa ? programa.tipo_tarjeta : tarjeta.comercios.tipo_tarjeta;
  const selloMeta = programa ? programa.sello_meta : tarjeta.comercios.sello_meta;

  // Branding por programa (0027). A DIFERENCIA de tipo/meta, acá la herencia SÍ es campo por campo:
  // el programa define lo que quiera y el resto viene del comercio. Toda esa lógica vive en
  // brandingEfectivo para que los nueve consumidores no puedan divergir.
  const c = tarjeta.comercios;
  const marca = brandingEfectivo(
    {
      colorFondo: c.color_fondo,
      colorTexto: c.color_texto,
      colorLabel: c.color_label,
      logoUrl: c.logo_url,
      heroUrl: c.hero_url,
      stripUrl: c.strip_url,
      selloIconoUrl: c.sello_icono_url,
      difuminadoFranja: c.difuminado_franja,
    },
    programa
      ? {
          brandingPropio: programa.branding_propio,
          colorFondo: programa.color_fondo,
          colorTexto: programa.color_texto,
          colorLabel: programa.color_label,
          logoUrl: programa.logo_url,
          heroUrl: programa.hero_url,
          stripUrl: programa.strip_url,
          selloIconoUrl: programa.sello_icono_url,
          // `?? undefined` porque en el programa esta columna es nullable y en BrandingBase no:
          // undefined activa el `??` de brandingEfectivo y hereda; null lo activaría igual, pero
          // el tipo pide undefined para no prometer un string que no está.
          difuminadoFranja: programa.difuminado_franja ?? undefined,
        }
      : null,
  );

  // Reverso por programa (0029), exactamente el mismo criterio que el branding de arriba: herencia
  // campo por campo, con el interruptor `reverso_propio` mandando sobre los campos. Sin esto, las
  // dos tarjetas del mismo negocio comparten un único dorso y el cupón de campaña no puede decir
  // cuándo vence.
  const dorso = reversoEfectivo(
    {
      terminosUso: c.terminos_uso,
      redInstagram: c.red_instagram,
      redFacebook: c.red_facebook,
      redWhatsapp: c.red_whatsapp,
      sitioWeb: c.sitio_web,
      mostrarComoFunciona: c.mostrar_como_funciona,
    },
    programa
      ? {
          reversoPropio: programa.reverso_propio,
          terminosUso: programa.terminos_uso,
          redInstagram: programa.red_instagram,
          redFacebook: programa.red_facebook,
          redWhatsapp: programa.red_whatsapp,
          sitioWeb: programa.sitio_web,
          // Acá se pasa el null TAL CUAL, sin `?? undefined`: en esta columna null significa
          // "heredá" y el tipo ReversoPrograma ya lo admite. Convertirlo a `false` —que es lo que
          // haría un `?? false` copiado del branding— apagaría la sección automática en todas las
          // tarjetas de un programa que nunca la tocó.
          mostrarComoFunciona: programa.mostrar_como_funciona,
        }
      : null,
  );

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
      colorFondo: marca.colorFondo ?? 'rgb(35, 24, 18)',
      colorTexto: marca.colorTexto ?? 'rgb(255, 255, 255)',
      colorLabel: marca.colorLabel ?? 'rgb(255, 255, 255)',
      tipoTarjeta,
      selloMeta,
      stripUrl: marca.stripUrl,
      selloIconoUrl: marca.selloIconoUrl,
      heroUrl: marca.heroUrl,
      logoUrl: marca.logoUrl,
      difuminadoFranja: marca.difuminadoFranja,
      // El reverso se ARMA en cada generación, nunca se congela una copia: un reverso que promete
      // una recompensa que el dueño ya cambió es una promesa incumplida frente al cliente final.
      reverso: construirReverso({
        nombreComercio: tarjeta.comercios.nombre,
        tipoTarjeta,
        selloMeta,
        mostrarComoFunciona: dorso.mostrarComoFunciona,
        terminosUso: dorso.terminosUso,
        redInstagram: dorso.redInstagram,
        redFacebook: dorso.redFacebook,
        redWhatsapp: dorso.redWhatsapp,
        sitioWeb: dorso.sitioWeb,
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
