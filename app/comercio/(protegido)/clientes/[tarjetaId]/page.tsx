import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { historialTarjeta, etiquetaClase } from '@/lib/comercio/historial';
import { resolverProgramaDeTarjeta } from '@/lib/comercio/programas';
import { describirFila } from '@/lib/tarjetas/estadoTarjeta';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import { listarNiveles } from '@/lib/tarjetas/descuento';
import { ZONA_HORARIA_DEFAULT } from '@/lib/comercio/zonasHorarias';

export const dynamic = 'force-dynamic';

// Ficha forense de un cliente: cada movimiento con su hora, su sucursal, su cajero y su motivo.
// Es la pantalla que contesta "¿quién le puso estos cinco sellos y cuándo?".
//
// Gate de DUEÑO, no compartido: el cajero corrige sus errores desde el escáner (donde ya tiene la
// tarjeta resuelta) y no necesita ver el historial completo del cliente, incluyendo qué hizo cada
// uno de sus compañeros.

export default async function PaginaFichaCliente({
  params,
}: {
  params: Promise<{ tarjetaId: string }>;
}) {
  const { comercioId } = await verifyComercioOwner();
  const { tarjetaId } = await params;

  const supabase = createServiceClient();

  // Scopeada por comercio_id: conocer el id de una tarjeta ajena no da acceso a su historial.
  const { data: tarjeta } = await supabase
    .from('tarjetas')
    // Las tres columnas de estado van SIEMPRE: sin ellas esta ficha decía "0 puntos" en cupón,
    // membresía y descuento. Ver lib/tarjetas/estadoTarjeta.ts.
    .select('id, puntos_actuales, vigencia_hasta, usado_en, acumulado_centavos, qr_token, clientes(nombre, telefono)')
    .eq('id', tarjetaId)
    .eq('comercio_id', comercioId)
    .maybeSingle();

  const { data: comercio } = await supabase
    .from('comercios')
    .select('zona_horaria')
    .eq('id', comercioId)
    .maybeSingle();

  if (!tarjeta) {
    return (
      <main className="admin-main" style={{ maxWidth: 640 }}>
        <div className="admin-encabezado reveal d1">
          <h1 className="title" style={{ margin: 0 }}>Cliente</h1>
          <Link className="admin-fila-slug" href="/comercio/clientes">← Volver</Link>
        </div>
        <p className="admin-error" role="alert">Esa tarjeta no existe en tu comercio.</p>
      </main>
    );
  }

  const movimientos = await historialTarjeta(supabase, comercioId, tarjetaId, { limite: 200 });

  const zona = comercio?.zona_horaria ?? ZONA_HORARIA_DEFAULT;
  // La zona del COMERCIO, no la del servidor: Vercel corre en UTC y sin esto las horas saldrían
  // corridas seis horas. En una pantalla forense la hora ES el dato.
  const formatoFecha = new Intl.DateTimeFormat('es-SV', {
    timeZone: zona,
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // El tipo sale del PROGRAMA de ESTA tarjeta, no de comercios.tipo_tarjeta (columna legada desde la
  // 0024). Un comercio de sellos con un segundo programa de cupón mostraba la ficha del cupón como
  // si fuera de sellos: "0 puntos" arriba y "/8" en cada movimiento del historial.
  const programa = await resolverProgramaDeTarjeta(supabase, comercioId, tarjetaId);
  const tipoTarjeta = programa?.tipoTarjeta ?? 'puntos';
  const niveles = tipoTarjeta === 'descuento' ? ((await listarNiveles(supabase, comercioId)) ?? []) : [];

  const selloMeta = programa?.selloMeta ?? null;
  const esSellos = tipoTarjeta === 'sellos';
  const saldoTexto = describirFila(
    tarjeta,
    tipoTarjeta,
    selloMeta,
    niveles,
    hoyEnZona(comercio?.zona_horaria ?? null),
  );

  return (
    <main className="admin-main" style={{ maxWidth: 720 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>{tarjeta.clientes?.nombre ?? 'Cliente'}</h1>
        <Link className="admin-fila-slug" href="/comercio/clientes">← Volver</Link>
      </div>

      <section className="panel reveal d2" style={{ marginTop: 0, textAlign: 'center' }}>
        {tarjeta.clientes?.telefono && (
          <p className="admin-fila-slug dato-mono">{tarjeta.clientes.telefono}</p>
        )}
        <p className="metric-valor" style={{ fontSize: '2rem', marginTop: 8, color: 'var(--acento)' }}>
          {saldoTexto}
        </p>
        <Link
          className="btn-borde"
          style={{ marginTop: 12 }}
          href={`/comercio/escanear?token=${encodeURIComponent(tarjeta.qr_token)}`}
        >
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">add_circle</span>
          Acreditar / Canjear / Corregir
        </Link>
      </section>

      <section className="reveal d3" style={{ marginTop: 22 }}>
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Historial de movimientos</p>

        {/* `null` NO es lo mismo que lista vacía, y por eso historialTarjeta no hace fail-soft a []:
            en una pantalla de auditoría, mostrar "sin movimientos" cuando en realidad falló la
            consulta le diría al dueño "tu cajero no hizo nada" — la conclusión opuesta a la verdad. */}
        {movimientos === null ? (
          <p className="admin-error" role="alert">
            No se pudo cargar el historial. Recarga la página.
          </p>
        ) : movimientos.length === 0 ? (
          <p className="admin-vacio">Este cliente todavía no tiene movimientos.</p>
        ) : (
          <div className="admin-lista">
            {movimientos.map((m) => (
              <div key={m.id} className="admin-fila" style={{ alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
                  <span
                    className={`icono-circulo ${m.clase === 'ajuste' ? 'neutro' : m.clase === 'canje' ? 'neutro' : 'menta'}`}
                    aria-hidden="true"
                  >
                    <span className="icono">
                      {m.clase === 'ajuste' ? 'undo' : m.clase === 'canje' ? 'redeem' : 'add_circle'}
                    </span>
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="admin-fila-nombre">
                      {etiquetaClase(m.clase)}
                      {m.recompensaNombre ? `: ${m.recompensaNombre}` : ''}
                      {m.forzado && (
                        <span
                          className="admin-fila-slug"
                          style={{
                            marginLeft: 8,
                            color: 'var(--acento)',
                            border: '1px solid var(--acento)',
                            borderRadius: 999,
                            padding: '1px 8px',
                            fontSize: '0.7rem',
                          }}
                        >
                          Autorizada
                        </span>
                      )}
                    </div>
                    <div className="admin-fila-slug dato-mono">{formatoFecha.format(new Date(m.ocurrioEn))}</div>
                    <div className="admin-fila-slug">
                      {m.sucursalNombre ?? 'Sin sucursal'}
                      {m.cajeroEmail ? ` · ${m.cajeroEmail}` : ' · sin cajero registrado'}
                      {m.monto !== null && ` · compra $${m.monto.toFixed(2)}`}
                    </div>
                    {m.motivo && (
                      <div className="admin-fila-slug" style={{ fontStyle: 'italic', marginTop: 2 }}>
                        “{m.motivo}”
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}>
                  <div
                    className="admin-fila-nombre dato-mono"
                    style={{ color: m.delta < 0 ? 'var(--texto)' : 'var(--menta)' }}
                  >
                    {m.delta > 0 ? `+${m.delta}` : m.delta}
                  </div>
                  <div className="admin-fila-slug dato-mono">
                    queda {m.saldoResultante}
                    {esSellos && selloMeta ? `/${selloMeta}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
