import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas } from '@/lib/comercio/programas';
import { brandingDeProgramas, hayMarcaPropia } from '@/lib/comercio/guardarBrandingPrograma';
import { reversoDePrograma, hayReversoPropio } from '@/lib/comercio/guardarReversoPrograma';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import FormularioBranding from './FormularioBranding';
import FormularioReverso from './FormularioReverso';
import SubidaImagen from './SubidaImagen';
import AvisoComercioActivo from '../AvisoComercioActivo';

export const dynamic = 'force-dynamic';

const COLOR_FONDO_POR_DEFECTO = 'rgb(19, 19, 21)';
const COLOR_TEXTO_POR_DEFECTO = 'rgb(245, 245, 240)';
const COLOR_LABEL_POR_DEFECTO = 'rgb(255, 157, 66)';

// `?nuevo=1` lo pone accionCrearComercioPropio al aterrizar acá tras el alta self-serve: sin ese
// aviso, el dueño llega al editor de marca de un comercio que acaba de crear sin saber POR QUÉ está
// en esta pantalla (el header ya cambió de comercio bajo sus pies).
//
// `?programa=<id>` elige QUÉ TARJETA se está diseñando. Sin él se diseña la marca del COMERCIO, que
// es la base que heredan todas las tarjetas. Mismo patrón de Server Component leyendo searchParams
// que el `?nuevo=1`: el selector son enlaces, sin JS, y cada tarjeta tiene su URL para compartir.
export default async function PaginaBranding({
  searchParams,
}: {
  searchParams: Promise<{ nuevo?: string; programa?: string }>;
}) {
  const { comercioId } = await verifyComercioOwner();
  const { nuevo, programa: programaParam } = await searchParams;

  const supabase = createServiceClient();
  const [{ data: c }, programas] = await Promise.all([
    supabase
      .from('comercios')
      .select('nombre, tipo_tarjeta, color_fondo, color_texto, color_label, sello_meta, logo_url, strip_url, hero_url, sello_icono_url, difuminado_franja, terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona')
      .eq('id', comercioId)
      .maybeSingle(),
    // Solo los activos: darle diseño propio a una tarjeta desactivada no se ve en ningún lado, y su
    // color de fondo crearía una clase PERMANENTE en Google para un programa en el que ya nadie
    // puede registrarse.
    listarProgramas(supabase, comercioId),
  ]);

  if (!c) {
    return (
      <main className="admin-main">
        <p className="admin-error" role="alert">No se pudo cargar tu comercio. Recarga la página.</p>
      </main>
    );
  }

  const activos = programas ?? [];
  // `find` y no una consulta por id: así un `?programa=` de otro comercio, de una tarjeta
  // desactivada o inventado no encuentra nada y cae en el diseño del negocio, sin filtrar la
  // existencia de programas ajenos.
  const seleccionado = programaParam ? (activos.find((p) => p.id === programaParam) ?? null) : null;
  const paramInvalido = Boolean(programaParam) && seleccionado === null;

  // El selector aparece con dos o más tarjetas activas — con una sola, diseñarla "aparte" del
  // negocio no tiene sentido y sería un botón para meterse en problemas. La segunda condición
  // garantiza que siempre haya camino de vuelta si se llegó por una URL con `?programa=`.
  const mostrarSelector = activos.length >= 2 || seleccionado !== null;

  const marcaComercio = {
    color_fondo: c.color_fondo ?? COLOR_FONDO_POR_DEFECTO,
    color_texto: c.color_texto ?? COLOR_TEXTO_POR_DEFECTO,
    color_label: c.color_label ?? COLOR_LABEL_POR_DEFECTO,
    difuminado_franja: c.difuminado_franja,
  };
  const reversoComercio = {
    terminos_uso: c.terminos_uso ?? '',
    red_instagram: c.red_instagram ?? '',
    red_facebook: c.red_facebook ?? '',
    red_whatsapp: c.red_whatsapp ?? '',
    sitio_web: c.sitio_web ?? '',
    mostrar_como_funciona: c.mostrar_como_funciona,
  };

  // Los datos de la tarjeta elegida. Se piden solo cuando hay una: el caso normal —diseñar el
  // negocio— no paga dos consultas de más.
  const [marcasPrograma, reversoPrograma] = seleccionado
    ? await Promise.all([
        brandingDeProgramas(supabase, comercioId),
        reversoDePrograma(supabase, comercioId, seleccionado.id),
      ])
    : [null, null];
  const marca = marcasPrograma?.find((m) => m.programaId === seleccionado?.id) ?? null;

  const esSellos = seleccionado
    ? tipoOPuntos(seleccionado.tipoTarjeta).valor === 'sellos'
    : c.tipo_tarjeta === 'sellos';
  const nombreTarjeta = seleccionado ? seleccionado.nombre : c.nombre;

  // Cada etiqueta dice DÓNDE aparece la imagen en el pass — "Imagen principal" a secas no le
  // decía nada al dueño (confusión real vista en el piloto).
  const imagenes: { campo: string; etiqueta: string; propia: string | null; heredada: string | null; google: boolean }[] = [
    { campo: 'logo', etiqueta: 'Logo (esquina superior del pass)', propia: marca?.logoUrl ?? null, heredada: c.logo_url, google: true },
    { campo: 'hero', etiqueta: 'Foto de fondo de la franja', propia: marca?.heroUrl ?? null, heredada: c.hero_url, google: true },
    { campo: 'strip', etiqueta: 'Franja personalizada (reemplaza la grilla de sellos)', propia: marca?.stripUrl ?? null, heredada: c.strip_url, google: false },
  ];
  if (esSellos) {
    imagenes.push({ campo: 'sello_icono', etiqueta: 'Ícono de los sellos', propia: marca?.selloIconoUrl ?? null, heredada: c.sello_icono_url, google: false });
  }

  // Ninguno de los tres campos que crean la tarjeta en Google está definido todavía: recién ahí
  // subir un logo o una portada cruza la línea de lo irreversible.
  const cruzaLaLinea =
    marca !== null && marca.colorFondo === null && marca.logoUrl === null && marca.heroUrl === null;

  const usaDisenoPropio = marca?.brandingPropio ?? false;
  const tieneDisenoGuardado = marca
    ? hayMarcaPropia({
        colorFondo: marca.colorFondo,
        colorTexto: marca.colorTexto,
        colorLabel: marca.colorLabel,
        difuminadoFranja: marca.difuminadoFranja,
        logoUrl: marca.logoUrl,
        heroUrl: marca.heroUrl,
        stripUrl: marca.stripUrl,
        selloIconoUrl: marca.selloIconoUrl,
      })
    : false;
  const tieneReversoGuardado = reversoPrograma
    ? hayReversoPropio({
        terminosUso: reversoPrograma.terminosUso,
        redInstagram: reversoPrograma.redInstagram,
        redFacebook: reversoPrograma.redFacebook,
        redWhatsapp: reversoPrograma.redWhatsapp,
        sitioWeb: reversoPrograma.sitioWeb,
        mostrarComoFunciona: reversoPrograma.mostrarComoFunciona,
      })
    : false;

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <div>
          <h1 className="title" style={{ margin: 0 }}>Editor de marca</h1>
          <p className="lede" style={{ marginTop: 6, fontSize: '0.92rem' }}>
            Personalizá la tarjeta que tus clientes llevan en su billetera.
          </p>
        </div>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      {/* El aviso de contexto se omite cuando el dueño acaba de llegar de crear el comercio: el
          banner de abajo ya le dice exactamente dónde está y por qué, y dos carteles seguidos
          diciendo lo mismo es ruido. */}
      {nuevo !== '1' && <AvisoComercioActivo />}

      {nuevo === '1' && (
        <p className="admin-vacio" role="status" style={{ marginBottom: 18 }}>
          Tu comercio nuevo ya está creado. Este es su editor de marca: configurá colores, logo e
          imágenes de la tarjeta{esSellos ? ' y la meta de sellos' : ''}.
        </p>
      )}

      {/* Selector de tarjeta. Enlaces GET, sin JS: cada tarjeta tiene su URL. Mismo patrón visual
          que los filtros de Reportes. */}
      {mostrarSelector && (
        <section className="reveal d1" style={{ marginBottom: 22 }}>
          <p className="titulo-seccion" style={{ marginBottom: 10 }}>¿Qué tarjeta estás diseñando?</p>
          <div className="filtro-chips">
            <Link className={`filtro-chip${!seleccionado ? ' activo' : ''}`} href="/comercio/branding">
              Todas mis tarjetas
            </Link>
            {activos.map((p) => (
              <Link
                key={p.id}
                className={`filtro-chip${seleccionado?.id === p.id ? ' activo' : ''}`}
                href={`/comercio/branding?programa=${p.id}`}
              >
                {p.nombre}
              </Link>
            ))}
          </div>
          <p className="admin-fila-slug" style={{ marginTop: 8 }}>
            {seleccionado
              ? `Estás diseñando solo “${seleccionado.nombre}”. Lo que dejes vacío lo toma del diseño de tu negocio.`
              : 'Este es el diseño de tu negocio: lo usan todas tus tarjetas. Elegí una de arriba solo si querés que esa se vea distinta.'}
          </p>
        </section>
      )}

      {paramInvalido && (
        <p className="admin-vacio" role="status" style={{ marginBottom: 18 }}>
          Esa tarjeta ya no está activa. Estás viendo el diseño de tu negocio.
        </p>
      )}

      <FormularioBranding
        nombreComercio={c.nombre}
        esSellos={esSellos}
        programaId={seleccionado?.id ?? null}
        nombreTarjeta={nombreTarjeta}
        inicial={
          seleccionado
            ? {
                // Vacío = heredá. El placeholder del campo muestra lo que hereda hoy.
                color_fondo: marca?.colorFondo ?? '',
                color_texto: marca?.colorTexto ?? '',
                color_label: marca?.colorLabel ?? '',
                sello_meta: marca?.selloMeta != null ? String(marca.selloMeta) : '',
                difuminado_franja: marca?.difuminadoFranja ?? '',
              }
            : {
                ...marcaComercio,
                sello_meta: c.sello_meta != null ? String(c.sello_meta) : '',
              }
        }
        heredado={seleccionado ? marcaComercio : null}
        usaDisenoPropio={usaDisenoPropio}
        tieneDisenoGuardado={tieneDisenoGuardado}
        urls={
          seleccionado
            ? {
                logo: marca?.logoUrl ?? c.logo_url,
                hero: marca?.heroUrl ?? c.hero_url,
                selloIcono: marca?.selloIconoUrl ?? c.sello_icono_url,
              }
            : { logo: c.logo_url, hero: c.hero_url, selloIcono: c.sello_icono_url }
        }
        subidas={imagenes.map(({ campo, etiqueta, propia, heredada, google }) => (
          <SubidaImagen
            key={campo}
            campo={campo}
            etiqueta={etiqueta}
            urlActual={seleccionado ? propia : heredada}
            programaId={seleccionado?.id ?? null}
            urlHeredada={seleccionado ? heredada : null}
            // El aviso es de la tarjeta del PROGRAMA en Google: el logo del negocio ya vive en la
            // clase que todo comercio tiene desde su primer pase, y avisar ahí sería una alarma
            // sobre algo que ya pasó hace rato.
            avisaGoogle={seleccionado !== null && google}
            cruzaLaLinea={cruzaLaLinea}
          />
        ))}
      />

      {/* El reverso va al final del editor de marca y no en una pantalla aparte: es conceptualmente
          lo mismo que ya vive acá —cómo se ve y qué dice tu tarjeta— y el nav inferior no tiene
          espacio para otra entrada. Las columnas nulas entran como '' porque los campos son
          controlados: un value={null} le pide a React cambiar de no-controlado a controlado. */}
      <FormularioReverso
        nombreComercio={c.nombre}
        esSellos={esSellos}
        programaId={seleccionado?.id ?? null}
        nombreTarjeta={nombreTarjeta}
        inicial={
          seleccionado
            ? {
                terminos_uso: reversoPrograma?.terminosUso ?? '',
                red_instagram: reversoPrograma?.redInstagram ?? '',
                red_facebook: reversoPrograma?.redFacebook ?? '',
                red_whatsapp: reversoPrograma?.redWhatsapp ?? '',
                sitio_web: reversoPrograma?.sitioWeb ?? '',
                // null = heredar. NO se colapsa a false: apagaría la sección en esta tarjeta.
                mostrar_como_funciona: reversoPrograma?.mostrarComoFunciona ?? null,
              }
            : reversoComercio
        }
        heredado={seleccionado ? reversoComercio : null}
        usaReversoPropio={reversoPrograma?.reversoPropio ?? false}
        tieneReversoGuardado={tieneReversoGuardado}
      />
    </main>
  );
}
