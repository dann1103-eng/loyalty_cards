import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas, MAXIMO_PROGRAMAS_ACTIVOS } from '@/lib/comercio/programas';
import { brandingDeProgramas } from '@/lib/comercio/guardarBrandingPrograma';
import { urlRegistroPrograma } from '@/lib/comercio/urlRegistroPrograma';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import AvisoComercioActivo from '../AvisoComercioActivo';
import FormularioNuevoPrograma from './FormularioNuevoPrograma';
import FormularioConfiguracionPrograma from './FormularioConfiguracionPrograma';
import FormularioMarcaPrograma, { type MarcaHeredada } from './FormularioMarcaPrograma';
import BotonDesactivarPrograma from './BotonDesactivarPrograma';

export const dynamic = 'force-dynamic';

export default async function PaginaProgramas() {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  // El branding del comercio es lo que cada programa HEREDA cuando no define lo suyo: se muestra
  // como placeholder de cada campo para que el dueño vea qué está usando hoy (migración 0027).
  const [{ data: comercio }, programas, marcas] = await Promise.all([
    supabase
      .from('comercios')
      .select(
        'slug, color_fondo, color_texto, color_label, logo_url, hero_url, strip_url, sello_icono_url, difuminado_franja',
      )
      .eq('id', comercioId)
      .maybeSingle(),
    listarProgramas(supabase, comercioId, { soloActivos: false }),
    brandingDeProgramas(supabase, comercioId),
  ]);

  const heredada: MarcaHeredada = {
    colorFondo: comercio?.color_fondo ?? null,
    colorTexto: comercio?.color_texto ?? null,
    colorLabel: comercio?.color_label ?? null,
    logoUrl: comercio?.logo_url ?? null,
    heroUrl: comercio?.hero_url ?? null,
    stripUrl: comercio?.strip_url ?? null,
    selloIconoUrl: comercio?.sello_icono_url ?? null,
    difuminadoFranja: comercio?.difuminado_franja ?? 'medio',
  };
  const marcaPorPrograma = new Map(marcas.map((m) => [m.programaId, m]));

  // QR de cada programa activo. Uno desactivado no lleva QR: resolverProgramaPorSlug exige
  // activo=true, así que registrar un cliente con ese código ya no funciona — mostrarlo invitaría
  // a escanear algo roto.
  const filas = await Promise.all(
    (programas ?? []).map(async (p) => {
      const urlRegistro =
        comercio?.slug && p.activo
          ? urlRegistroPrograma(process.env.NEXT_PUBLIC_BASE_URL, comercio.slug, p.slug, p.esPrincipal)
          : null;
      const qr = urlRegistro
        ? await QRCode.toDataURL(urlRegistro, { width: 220, margin: 1, color: { dark: '#0e0e0e', light: '#ffffff' } })
        : null;
      return { programa: p, urlRegistro, qr };
    }),
  );

  const activos = (programas ?? []).filter((p) => p.activo).length;
  const hayLugar = activos < MAXIMO_PROGRAMAS_ACTIVOS;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Programas de tarjeta</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>
      <p className="lede reveal d1" style={{ marginTop: 0 }}>
        Hasta {MAXIMO_PROGRAMAS_ACTIVOS} programas activos a la vez, cada uno con su tipo, su
        configuración y su propio código QR de registro.
      </p>

      <AvisoComercioActivo />

      {!programas ? (
        <p className="admin-error" role="alert">No se pudieron cargar los programas. Recargá la página.</p>
      ) : (
        <div className="reveal d2" style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {filas.map(({ programa, urlRegistro, qr }) => {
            const tipo = tipoOPuntos(programa.tipoTarjeta);
            const marca = marcaPorPrograma.get(programa.id);
            return (
              <div key={programa.id} className="panel" style={{ marginTop: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <h2 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>{programa.nombre}</h2>
                      {programa.esPrincipal && <span className="pastilla pastilla-activo">Principal</span>}
                      {!programa.activo && <span className="pastilla pastilla-inactivo">Desactivado</span>}
                    </div>
                    <p className="admin-fila-slug" style={{ marginTop: 2 }}>{tipo.etiqueta} — {tipo.descripcion}</p>
                  </div>
                  {programa.activo && !programa.esPrincipal && (
                    <BotonDesactivarPrograma id={programa.id} nombre={programa.nombre} />
                  )}
                </div>

                {programa.activo && <FormularioConfiguracionPrograma programa={programa} />}

                {/* Solo para programas activos: darle marca a uno desactivado no se ve en ningún
                    lado, y el logo/color de fondo crearían una clase PERMANENTE en Google para un
                    programa en el que ya nadie puede registrarse. */}
                {programa.activo && marca && (
                  <FormularioMarcaPrograma
                    programaId={programa.id}
                    nombrePrograma={programa.nombre}
                    esSellos={tipo.valor === 'sellos'}
                    marca={marca}
                    heredada={heredada}
                  />
                )}

                {qr && urlRegistro && (
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <div className="qr-tile" style={{ maxWidth: 160, margin: '0 auto' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
                      <img src={qr} alt={`Código QR de registro de ${programa.nombre}`} />
                    </div>
                    <p className="qr-codigo">{urlRegistro.replace(/^https?:\/\//, '')}</p>
                    <a
                      className="btn-borde"
                      style={{ marginTop: 8 }}
                      href={qr}
                      download={`qr-${comercio?.slug}-${programa.slug}.png`}
                    >
                      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
                      Descargar
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="reveal d3" style={{ marginTop: 22 }}>
        {hayLugar ? (
          <FormularioNuevoPrograma />
        ) : (
          <p className="admin-vacio">
            Ya tenés {MAXIMO_PROGRAMAS_ACTIVOS} programas activos. Desactivá uno para crear otro.
          </p>
        )}
      </div>
    </main>
  );
}
