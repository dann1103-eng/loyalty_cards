import { NextResponse, type NextRequest } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '../supabase/server';
import { brandingEfectivo } from '../comercio/brandingEfectivo';
import { encuadreDelComercio, encuadreDelPrograma } from '../comercio/encuadreFranja';
import { bajarLogo } from './logoRemoto';

// Lo que comparten las rutas logo.png y logo-ancho.png de app/api/comercios/[comercioId]/ (los dos
// logos de la LoyaltyClass de Google, ver logosClase.ts): leer la marca efectiva, bajar el logo,
// componerlo y, si la composición falla, servir el original.
//
// ESTAS RUTAS NO PUEDEN FALLAR PARA UN COMERCIO CON LOGO. Google descarga las imágenes de la clase al
// crearla o parcharla, y si no puede bajar UNA rechaza el patch ENTERO con `400 Image cannot be loaded`
// (scripts/actualizar-frente-google.ts lo documenta). A diferencia de la portada (heroImage es
// opcional: franja.png responde 404 sin problema), `programLogo` es obligatorio: si esta ruta fallara,
// fallaría la sincronización de la clase, y con ella Google Wallet para cada registro nuevo del
// comercio y el link de "Agregar a Google Wallet". Por eso, si componer falla, se sirve el logo ORIGINAL
// (convertido a PNG si hace falta): se ve como se veía antes de esta ruta, pero la clase se sincroniza.
// 404 solo cuando algo NO EXISTE: el comercio, su logo, o el programa (ajeno o inexistente). 502 cuando
// el problema es pasajero o de los bytes: un error al leer la base, un bucket que no responde, o un
// "logo" que no es una imagen que sharp pueda leer.

// Mismas columnas y misma resolución de marca que franja.png: `?programa=` elige la marca EFECTIVA de
// ese programa (logo y color propios o heredados), la misma que usa syncClasePrograma para armar la URL.
const COLUMNAS_MARCA =
  'color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja, encuadre_franja, foco_franja_x, foco_franja_y, zoom_franja';

// Más holgado que el tope de la MEDICIÓN (logoRemoto.ts, 2 s): acá no hay un cliente esperando, es
// Google el que descarga, y cortar antes solo convertiría un bucket lento en un patch rechazado.
const TIEMPO_MAXIMO_DESCARGA_MS = 10_000;

export type ComponerLogo = (logo: Buffer, marca: { colorFondo: string | null }) => Promise<Buffer>;

function png(bytes: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}

// El respaldo: el logo tal como está en el bucket. Google pide PNG o JPEG, y el bucket acepta además
// WebP (imagenComercio.ts): se convierte a PNG si no lo es. Si sharp tampoco puede convertirlo, 502 y
// NUNCA los bytes crudos con su tipo de origen: la URL del logo la puede escribir cualquiera con acceso
// al admin de FM, y si apuntara a una página serviríamos `text/html` desde nuestro propio dominio. Y el
// reenvío tampoco salvaba nada: lo que sharp no lee, Google tampoco, así que el patch caería igual.
async function logoOriginal(bytes: Buffer): Promise<NextResponse> {
  try {
    const { format } = await sharp(bytes).metadata();
    return png(format === 'png' ? bytes : await sharp(bytes).png().toBuffer());
  } catch (error) {
    console.error('[google] el logo no es una imagen que sharp pueda leer; no hay nada que servir:', error);
    return NextResponse.json({ error: 'El logo no es una imagen legible' }, { status: 502 });
  }
}

export async function servirLogoClase(
  request: NextRequest,
  comercioId: string,
  componer: ComponerLogo,
): Promise<NextResponse> {
  const programaId = request.nextUrl.searchParams.get('programa');
  const supabase = createServiceClient();

  const [consultaComercio, consultaPrograma] = await Promise.all([
    supabase.from('comercios').select(COLUMNAS_MARCA).eq('id', comercioId).maybeSingle(),
    programaId
      ? supabase
          .from('programas_tarjeta')
          .select(`branding_propio, ${COLUMNAS_MARCA}`)
          .eq('id', programaId)
          // Scope por comercio: un programa ajeno o inexistente es 404, no "el comercio a secas".
          .eq('comercio_id', comercioId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // Un error de lectura NO es "no existe": es pasajero, como el bucket que no responde. 502, y el
  // próximo sync de la clase reintenta. Leído como 404 diría que el comercio o el programa no existen,
  // y 404 queda para eso (sin comercio, sin logo, programa ajeno).
  if (consultaComercio.error || consultaPrograma.error) {
    console.error(
      '[google] no se pudo leer la marca para el logo de la clase:',
      consultaComercio.error ?? consultaPrograma.error,
    );
    return NextResponse.json({ error: 'No se pudo leer la marca' }, { status: 502 });
  }

  const c = consultaComercio.data;
  const programa = consultaPrograma.data;
  if (!c || (programaId && !programa)) {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  }

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
      encuadreFranja: encuadreDelComercio(c),
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
          difuminadoFranja: programa.difuminado_franja ?? undefined,
          encuadreFranja: encuadreDelPrograma(programa),
        }
      : null,
  );

  if (!marca.logoUrl) {
    return NextResponse.json({ error: 'Sin logo' }, { status: 404 });
  }

  // Sin los bytes del logo no hay nada que servir, ni compuesto ni original. 502 y no 404: el logo
  // existe y el problema es pasajero (el bucket no respondió). Google rechaza ese patch y el próximo
  // sync de la clase —cada registro, cada "Agregar a Google Wallet"— lo vuelve a intentar. Redirigir
  // al logo crudo sería peor: Google lo cachearía bajo esta URL versionada, y el logo recortado
  // quedaría puesto hasta el próximo cambio de logo o de color.
  const logo = await bajarLogo(marca.logoUrl, TIEMPO_MAXIMO_DESCARGA_MS);
  if (!logo) {
    return NextResponse.json({ error: 'No se pudo bajar el logo' }, { status: 502 });
  }

  try {
    return png(await componer(logo.bytes, { colorFondo: marca.colorFondo }));
  } catch (error) {
    console.error('[google] no se pudo componer el logo de la clase; se sirve el original:', error);
    return logoOriginal(logo.bytes);
  }
}
