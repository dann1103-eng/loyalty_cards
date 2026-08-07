import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas } from '@/lib/comercio/programas';
import { describirFila, type NivelDeDescuento } from '@/lib/tarjetas/estadoTarjeta';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import { listarNiveles } from '@/lib/tarjetas/descuento';

export const dynamic = 'force-dynamic';

// El QR de cada cliente codifica EXACTAMENTE su qr_token — el mismo valor que lleva el barcode
// del pass en su billetera. Así, cuando exista el escáner del cajero (Fase 4), leer este QR
// impreso o leer el pass da idéntico resultado.
async function qrDeTarjeta(qrToken: string): Promise<string> {
  return QRCode.toDataURL(qrToken, {
    width: 320,
    margin: 1,
    color: { dark: '#0e0e0e', light: '#ffffff' },
  });
}

export default async function PaginaClientes({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // Gate COMPARTIDO (plan 2026-07-25 §4.8): el cajero usa el directorio para la asignación manual
  // de puntos — el botón "Acreditar / Canjear" entra al escáner, cuyas acciones ya re-verifican con
  // gate compartido y atribución server-side. Esta página es de solo lectura (sin Server Actions).
  const { comercioId, rol } = await verifyComercioAcceso();
  const { q } = await searchParams;
  const busqueda = (q ?? '').trim();

  const supabase = createServiceClient();
  // El tipo Y la meta salen del programa de CADA tarjeta desde la 0024: un comercio con más de un
  // programa activo puede tener clientes de tipos distintos —y con metas distintas— en la misma
  // lista. Del comercio queda solo la zona horaria, que sí es del local.
  const [{ data: comercio }, programas, { data: tarjetas, error }] = await Promise.all([
    supabase.from('comercios').select('zona_horaria').eq('id', comercioId).maybeSingle(),
    listarProgramas(supabase, comercioId, { soloActivos: false }),
    supabase
      // vigencia_hasta / usado_en / acumulado_centavos: sin ellas, esta lista le decía "0 puntos" al
      // dueño en toda tarjeta de cupón, membresía o descuento — los tres tipos cuyo estado no es un
      // número. Ver lib/tarjetas/estadoTarjeta.ts.
      .from('tarjetas')
      .select(
        'id, qr_token, puntos_actuales, vigencia_hasta, usado_en, acumulado_centavos, created_at, programa_id, clientes(nombre, telefono)',
      )
      .eq('comercio_id', comercioId)
      .order('created_at', { ascending: false }),
  ]);
  const programaPorId = new Map((programas ?? []).map((p) => [p.id, p]));

  // Los niveles solo hacen falta si el comercio tiene un programa de descuento; casi ninguno lo usa.
  let niveles: NivelDeDescuento[] = [];
  if ((programas ?? []).some((p) => p.tipoTarjeta === 'descuento')) {
    niveles = (await listarNiveles(supabase, comercioId)) ?? [];
  }
  const hoyIso = hoyEnZona(comercio?.zona_horaria ?? null);

  if (error) console.error('[comercio] falló la consulta de clientes:', error);

  // Filtro en servidor sobre el resultado (la lista del piloto es corta; paginar llegará después).
  const filtradas = (tarjetas ?? []).filter((t) => {
    if (!busqueda) return true;
    const cliente = t.clientes;
    const texto = `${cliente?.nombre ?? ''} ${cliente?.telefono ?? ''}`.toLowerCase();
    return texto.includes(busqueda.toLowerCase());
  });

  const conQr = await Promise.all(
    filtradas.map(async (t) => ({ ...t, qrDataUrl: await qrDeTarjeta(t.qr_token) })),
  );

  const saldoTexto = (t: Parameters<typeof describirFila>[0] & { programa_id: string }) => {
    const p = programaPorId.get(t.programa_id);
    return describirFila(t, p?.tipoTarjeta ?? 'puntos', p?.selloMeta ?? null, niveles, hoyIso);
  };

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <div>
          <h1 className="title" style={{ margin: 0 }}>Clientes</h1>
          <p className="lede" style={{ marginTop: 6, fontSize: '0.92rem' }}>
            <span className="dato-mono">{tarjetas?.length ?? 0}</span> con tu tarjeta en su billetera.
          </p>
          {/* Solo al dueño: la ruta tiene gate de owner y exportar la base del negocio no es tarea
              del cajero.

              Va con <a download> y NO con <Link>: el destino no es una página sino un Route Handler
              que devuelve un archivo, y Link haría navegación del router contra una respuesta que
              no es RSC. El atributo `download` es además lo que le dice a la regla de lint de Next
              que esto es una descarga y no un enlace interno mal hecho. */}
          {rol === 'owner' && (
            <a
              className="btn-borde"
              style={{ marginTop: 10 }}
              href="/comercio/clientes/exportar"
              download
            >
              <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
              Descargar mis clientes (CSV)
            </a>
          )}
        </div>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      {/* Buscador (GET: sin JS, el server filtra) */}
      <form className="reveal d2" method="GET" style={{ marginBottom: 18 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="q">Buscar</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={busqueda}
            placeholder="Nombre o teléfono…"
          />
        </div>
      </form>

      <div className="admin-lista reveal d3">
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar los clientes. Recarga la página.</p>
        ) : conQr.length === 0 ? (
          <p className="admin-vacio">
            {busqueda
              ? `Nadie coincide con "${busqueda}".`
              : 'Todavía nadie tiene tu tarjeta. Mostrá el QR de registro de tu local para sumar al primero.'}
          </p>
        ) : (
          conQr.map((t) => (
            <details key={t.id} className="admin-fila" style={{ display: 'block' }}>
              <summary
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  cursor: 'pointer',
                  listStyle: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo neutro" aria-hidden="true">
                    <span className="icono">person</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{t.clientes?.nombre ?? 'Cliente'}</div>
                    <div className="admin-fila-slug dato-mono">{t.clientes?.telefono}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="admin-fila-nombre dato-mono" style={{ fontSize: '0.95rem' }}>
                    {saldoTexto(t)}
                  </div>
                  <div className="admin-fila-slug">ver QR</div>
                </div>
              </summary>
              <div style={{ paddingTop: 16, textAlign: 'center' }}>
                <div className="qr-tile" style={{ maxWidth: 200, margin: '0 auto' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL del servidor */}
                  <img src={t.qrDataUrl} alt={`QR de la tarjeta de ${t.clientes?.nombre ?? 'cliente'}`} />
                </div>
                <p className="qr-codigo">{t.qr_token}</p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <Link className="btn-borde" href={`/comercio/escanear?token=${encodeURIComponent(t.qr_token)}`}>
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">add_circle</span>
                    Acreditar / Canjear
                  </Link>
                  {/* Solo al dueño: la ficha tiene gate de owner, así que mostrarle el enlace al
                      cajero sería enseñarle una puerta cerrada (misma política que RUTAS_CAJERO). */}
                  {rol === 'owner' && (
                    <Link className="btn-borde" href={`/comercio/clientes/${t.id}`}>
                      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">history</span>
                      Ver historial
                    </Link>
                  )}
                  <a
                    className="btn-borde"
                    href={t.qrDataUrl}
                    download={`qr-${(t.clientes?.nombre ?? 'cliente').toLowerCase().replace(/\s+/g, '-')}.png`}
                  >
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
                    Descargar
                  </a>
                </div>
              </div>
            </details>
          ))
        )}
      </div>

      <p className="nota reveal d4">
        El QR de cada cliente es el mismo que lleva su pass: cuando llegue el escáner del cajero,
        cualquiera de los dos suma sellos o puntos.
      </p>
    </main>
  );
}
