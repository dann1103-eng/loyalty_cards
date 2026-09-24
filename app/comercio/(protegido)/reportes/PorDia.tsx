import type { FilaReportePorDia } from '@/lib/reportes/reportes';
import { barrasSerie, huboActividad, tituloSerie, type TotalesResumen } from '@/lib/reportes/pantallaReportes';
import { AvisoBloque } from './AvisoBloque';

// "Por día" / "Por mes" (spec 2026-09-23 §2): las barras de reporte_por_dia en modo 'auto', que la SQL
// agrupa por mes cuando el tramo pasa de 62 días. El título lo dice tituloSerie y cada etiqueta,
// barrasSerie ("sep 2026" o "05/09").
//
// ══ EL ESTADO VACÍO SE DECIDE CON LA FILA TOTAL DEL RESUMEN ══
// NUNCA con `filas.length === 0` (contrato de la 0040): un alcance que ya operaba devuelve el tramo
// entero con filas en CERO, y uno que nunca operó, cero filas. Por eso este bloque recibe los totales
// de reporte_resumen, y depende de LAS DOS lecturas: si cualquiera falló (null), muestra el aviso en
// vez de barras que no se sabe si están vacías de verdad.
export function PorDia({ filas, totales }: { filas: FilaReportePorDia[] | null; totales: TotalesResumen | null }) {
  const titulo = filas ? tituloSerie(filas) : 'Por día';
  const porMes = titulo === 'Por mes';

  return (
    <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 24 }}>
      <h2 className="admin-fila-nombre" style={{ fontSize: '1.1rem', marginBottom: 4 }}>
        {titulo}
      </h2>
      <p className="admin-fila-slug" style={{ marginBottom: 16 }}>
        Visitas / premios de cada {porMes ? 'mes' : 'día'}.
      </p>
      {filas === null || totales === null ? (
        <AvisoBloque />
      ) : !huboActividad(totales) ? (
        <p style={{ color: 'var(--texto-2)', fontSize: '0.9rem' }}>Sin movimientos en este período.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {barrasSerie(filas).map((barra) => (
            <div key={barra.clave} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className="dato-mono"
                style={{ width: porMes ? 64 : 46, flexShrink: 0, fontSize: '0.72rem', color: 'var(--texto-2)' }}
              >
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
