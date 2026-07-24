import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { reporteSucursales, reporteTendencia, reporteTopClientes } from '@/lib/reportes/reportes';

export const dynamic = 'force-dynamic';

const DIAS_TENDENCIA = 14;
const TOP_LIMITE = 5;

// Etiqueta corta dd/mm a partir del `dia` (string "YYYY-MM-DD"). Se parte a mano en vez de `new Date`
// para no arrastrar el desfase de zona horaria (la SQL ya cortó los días en hora de El Salvador).
function etiquetaDia(dia: string): string {
  const [, mm, dd] = dia.split('-');
  return `${dd}/${mm}`;
}

// Bloque de estadística (número grande + etiqueta) reutilizado en las tarjetas por sucursal.
function Estadistica({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div>
      <div className="dato-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}>
        {valor}
      </div>
      <div className="admin-fila-slug" style={{ marginTop: 4 }}>{etiqueta}</div>
    </div>
  );
}

export default async function PaginaReportes() {
  // Gate del dueño. comercioId viene SIEMPRE del gate (sesión verificada), nunca de la URL/formulario:
  // los reportes se scopean por ese id, así un dueño no ve la actividad de otro comercio.
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const [sucursales, tendencia, topClientes] = await Promise.all([
    reporteSucursales(supabase, comercioId),
    reporteTendencia(supabase, comercioId, DIAS_TENDENCIA),
    reporteTopClientes(supabase, comercioId, TOP_LIMITE),
  ]);

  // Totales del comercio para las métricas de cabecera. Se suman acreditaciones y canjes (agregables
  // sin doble conteo entre sucursales, a diferencia de clientes_unicos, que sí se solaparía).
  const totalVisitas = sucursales.reduce((suma, f) => suma + f.acreditaciones, 0);
  const totalPremios = sucursales.reduce((suma, f) => suma + f.canjes, 0);

  // Escala de las barras de tendencia (mínimo 1 para no dividir por cero cuando todo está en 0).
  const maxDia = Math.max(1, ...tendencia.map((d) => d.acreditaciones + d.canjes));
  const hayActividad = totalVisitas + totalPremios > 0;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <section className="reveal d1" style={{ marginBottom: 22 }}>
        <h1 className="title" style={{ fontSize: '1.7rem', margin: 0 }}>Reportes</h1>
        <p className="lede" style={{ marginTop: 6 }}>
          Cómo se mueve tu programa de lealtad por sucursal.
        </p>
      </section>

      {/* Métricas del comercio (mismas tarjetas C2 del panel). */}
      <section className="metric-pila reveal d2">
        <div className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Visitas acreditadas</span>
            <span className="icono" aria-hidden="true">sensors</span>
          </div>
          <div>
            <div className="metric-valor">{totalVisitas}</div>
            <div className="metric-sub">sellos/puntos otorgados</div>
          </div>
        </div>
        <div className="metric-carta menta">
          <div className="metric-etiqueta">
            <span>Premios canjeados</span>
            <span className="icono" aria-hidden="true">redeem</span>
          </div>
          <div>
            <div className="metric-valor">{totalPremios}</div>
            <div className="metric-sub">recompensas entregadas</div>
          </div>
        </div>
      </section>

      {/* Por sucursal */}
      <section className="reveal d3" style={{ marginBottom: 22 }}>
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Por sucursal</p>
        {sucursales.length === 0 ? (
          <p className="admin-vacio">Todavía no hay actividad registrada.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sucursales.map((s) => (
              <div key={s.sucursal_id ?? 'sin-sucursal'} className="panel" style={{ marginTop: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h2 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>
                    {s.sucursal_nombre ?? 'Sin sucursal'}
                  </h2>
                  {s.sucursal_activa === false && (
                    <span className="pastilla pastilla-inactivo">inactiva</span>
                  )}
                  {s.sucursal_id === null && (
                    <span className="admin-fila-slug">actividad sin asignar</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 28 }}>
                  <Estadistica valor={s.clientes_unicos} etiqueta="Clientes" />
                  <Estadistica valor={s.acreditaciones} etiqueta="Visitas" />
                  <Estadistica valor={s.canjes} etiqueta="Premios" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tendencia (barras simples: acreditaciones + canjes por día). */}
      <section className="panel reveal d4" style={{ marginTop: 0, marginBottom: 22 }}>
        <h2 className="admin-fila-nombre" style={{ fontSize: '1.1rem', marginBottom: 4 }}>
          Últimos {DIAS_TENDENCIA} días
        </h2>
        <p className="admin-fila-slug" style={{ marginBottom: 16 }}>
          Visitas y premios por día (visitas / premios).
        </p>
        {!hayActividad ? (
          <p style={{ color: 'var(--texto-2)', fontSize: '0.9rem' }}>
            Aún no hay movimientos para graficar.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tendencia.map((d) => {
              const total = d.acreditaciones + d.canjes;
              const pct = Math.round((total / maxDia) * 100);
              return (
                <div key={d.dia} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="dato-mono" style={{ width: 46, fontSize: '0.72rem', color: 'var(--texto-2)' }}>
                    {etiquetaDia(d.dia)}
                  </span>
                  <div style={{ flex: 1, height: 10, background: 'var(--superficie-3)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--acento)' }} />
                  </div>
                  <span className="dato-mono" style={{ width: 58, textAlign: 'right', fontSize: '0.72rem', color: 'var(--texto-2)' }}>
                    {d.acreditaciones}/{d.canjes}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Top de clientes */}
      <section className="reveal d5">
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Clientes más frecuentes</p>
        {topClientes.length === 0 ? (
          <p className="admin-vacio">Todavía no hay clientes con visitas.</p>
        ) : (
          <div className="admin-lista">
            {topClientes.map((c) => (
              <div key={c.cliente_id} className="admin-fila">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">person</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{c.cliente_nombre}</div>
                    <div className="admin-fila-slug">
                      <span className="dato-mono">{c.visitas}</span> visitas
                    </div>
                  </div>
                </div>
                <span className="admin-fila-slug dato-mono">{c.puntos_totales} pts</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
