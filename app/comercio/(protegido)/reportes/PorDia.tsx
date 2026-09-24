import type { FilaReportePorDia } from '@/lib/reportes/reportes';
import { estadoPorDia, type TotalesResumen } from '@/lib/reportes/pantallaReportes';
import { AvisoBloque } from './AvisoBloque';

// "Por día" / "Por mes" (spec 2026-09-23 §2): las barras de reporte_por_dia en modo 'auto', que la SQL
// agrupa por mes cuando el tramo pasa de 62 días. Este componente solo arma el markup: si el bloque
// muestra un error, el estado vacío o las barras lo decide estadoPorDia (lib/reportes/
// pantallaReportes.ts), con prueba y mutación, y ahí vive LA regla del bloque: el vacío sale de la fila
// TOTAL del resumen (`totales`), nunca de `filas.length === 0` (contrato de la 0040).
export function PorDia({ filas, totales }: { filas: FilaReportePorDia[] | null; totales: TotalesResumen | null }) {
  const estado = estadoPorDia(filas, totales);

  return (
    <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 24 }}>
      <h2 className="admin-fila-nombre" style={{ fontSize: '1.1rem', marginBottom: 4 }}>
        {estado.titulo}
      </h2>
      <p className="admin-fila-slug" style={{ marginBottom: 16 }}>
        {estado.subtitulo}
      </p>
      {estado.tipo === 'error' && <AvisoBloque que="la serie por día" />}
      {estado.tipo === 'vacio' && (
        <p style={{ color: 'var(--texto-2)', fontSize: '0.9rem' }}>Sin movimientos en este período.</p>
      )}
      {estado.tipo === 'barras' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {estado.barras.map((barra) => (
            <div key={barra.clave} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Sin ancho fijo: en una serie todas las etiquetas tienen los mismos caracteres
                  ("05/09", o "sep 2026") y la fuente es mono, así que las barras arrancan alineadas. */}
              <span className="dato-mono" style={{ minWidth: 46, flexShrink: 0, fontSize: '0.72rem', color: 'var(--texto-2)' }}>
                {barra.etiqueta}
              </span>
              <div className="pista" style={{ flex: 1 }} aria-hidden="true">
                <div className="pista-relleno" style={{ width: `${barra.pct}%` }} />
              </div>
              <span
                className="dato-mono"
                style={{ minWidth: 58, flexShrink: 0, textAlign: 'right', fontSize: '0.72rem', color: 'var(--texto-2)' }}
              >
                {barra.visitas}/{barra.premios}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
