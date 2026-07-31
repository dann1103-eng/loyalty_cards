import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas, MAXIMO_PROGRAMAS_ACTIVOS } from '@/lib/comercio/programas';
import { urlRegistroPrograma } from '@/lib/comercio/urlRegistroPrograma';
import { tipoOPuntos } from '@/lib/tarjetas/tipos';
import AvisoComercioActivo from '../AvisoComercioActivo';
import FormularioNuevoPrograma from './FormularioNuevoPrograma';
import FormularioConfiguracionPrograma from './FormularioConfiguracionPrograma';
import BotonDesactivarPrograma from './BotonDesactivarPrograma';

export const dynamic = 'force-dynamic';

export default async function PaginaProgramas() {
  const { comercioId } = await verifyComercioOwner();
  const supabase = createServiceClient();

  // Esta pantalla es el TIPO, la CONFIGURACIÓN y el QR de cada programa. El diseño de la tarjeta
  // (colores, imágenes y reverso) vive en Marca, que es donde está la vista previa en vivo —
  // duplicar el editor acá lo dejaba sin ella.
  const [{ data: comercio }, programas] = await Promise.all([
    supabase.from('comercios').select('slug').eq('id', comercioId).maybeSingle(),
    listarProgramas(supabase, comercioId, { soloActivos: false }),
  ]);

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

                {/* El diseño se edita en Marca, con la vista previa en vivo al lado. Solo para
                    programas activos: darle diseño propio a uno desactivado no se ve en ningún
                    lado, y su color de fondo crearía una clase PERMANENTE en Google para un
                    programa en el que ya nadie puede registrarse. */}
                {programa.activo && (
                  <Link
                    className="btn-borde"
                    style={{ marginTop: 12 }}
                    href={`/comercio/branding?programa=${programa.id}`}
                  >
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">palette</span>
                    Diseñar esta tarjeta
                  </Link>
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
