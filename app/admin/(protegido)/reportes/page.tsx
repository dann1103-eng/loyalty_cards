import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { reporteFmComercios, type FilaFmComercio } from '@/lib/reportes/reportes';

export const dynamic = 'force-dynamic';

// Número compacto con su etiqueta (columna de la fila de comercio).
function EstadisticaMini({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div style={{ textAlign: 'right', minWidth: 72 }}>
      <div className="dato-mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1.1 }}>
        {valor}
      </div>
      <div className="admin-fila-slug" style={{ fontSize: '0.7rem' }}>{etiqueta}</div>
    </div>
  );
}

export default async function PaginaReportesFm() {
  // Defensa en profundidad: el layout ya verificó, pero los layouts no se re-ejecutan en navegación
  // del lado del cliente. verifyFmAdmin() está memoizada, así que no cuesta una consulta extra.
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const comercios = await reporteFmComercios(supabase);

  // Acá había un "saldo circulante" de toda la cartera: la suma de `puntos_actuales` de todos los
  // comercios y todos los tipos, o sea sellos más centavos más visitas. No era un número en ninguna
  // unidad, y rotularlo "referencial" no lo volvía legible, así que se dejó de mostrar (spec
  // 2026-09-09, pendiente B). El saldo de UN comercio, bien calculado por tipo, está en su panel
  // (`resumenPrograma`). La columna todavía sale de `reporte_fm_comercios()` hasta la 0035: este
  // archivo dejó de leerla ANTES a propósito, porque retirarla primero de la base rompía la página.

  // Agrupación por cuenta. La función ya ordena por (cuenta_id is null), cuenta_nombre, comercio_nombre,
  // así que las filas de una misma cuenta llegan consecutivas → se agrupan comparando con la anterior.
  const grupos: { cuentaId: string | null; cuentaNombre: string | null; comercios: FilaFmComercio[] }[] = [];
  for (const fila of comercios) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.cuentaId === fila.cuenta_id) {
      ultimo.comercios.push(fila);
    } else {
      grupos.push({ cuentaId: fila.cuenta_id, cuentaNombre: fila.cuenta_nombre, comercios: [fila] });
    }
  }

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Reportes</h1>
      </div>

      {/* Métricas de la cartera FM (mismas tarjetas C2). `metric-pila` es una grilla de DOS columnas
          desde 760px: con una sola tarjeta quedaba la mitad derecha vacía, así que ocupa la fila
          entera. En móvil la pila es flex y `gridColumn` no hace nada. */}
      <section className="metric-pila reveal d2">
        <div className="metric-carta naranja" style={{ gridColumn: '1 / -1' }}>
          <div className="metric-etiqueta">
            <span>Comercios</span>
            <span className="icono" aria-hidden="true">storefront</span>
          </div>
          <div>
            <div className="metric-valor">{comercios.length}</div>
            <div className="metric-sub">en la cartera</div>
          </div>
        </div>
      </section>

      {comercios.length === 0 ? (
        <p className="admin-vacio">Todavía no hay comercios registrados.</p>
      ) : (
        grupos.map((g) => (
          <section key={g.cuentaId ?? 'sin-cuenta'} className="reveal d3" style={{ marginBottom: 26 }}>
            <p className="titulo-seccion" style={{ marginBottom: 10 }}>
              {g.cuentaNombre ?? 'Sin cuenta'}
            </p>
            <div className="admin-lista">
              {g.comercios.map((c) => (
                <div key={c.comercio_id} className="admin-fila">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <span className="icono-circulo acento" aria-hidden="true">
                      <span className="icono">storefront</span>
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="admin-fila-nombre">{c.comercio_nombre}</div>
                      <div className="admin-fila-slug">
                        <span className="dato-mono">{c.clientes}</span> clientes
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 18, flexShrink: 0 }}>
                    <EstadisticaMini valor={c.operaciones} etiqueta="Operaciones" />
                    <EstadisticaMini valor={c.canjes} etiqueta="Premios" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
