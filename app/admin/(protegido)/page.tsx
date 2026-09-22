import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { contarPagosAtencion } from '@/lib/comercios/pagosAdmin';
import {
  actividadReciente,
  contarSolicitudesPendientes,
  ingresosDelMes,
  tamanoDeCartera,
} from '@/lib/fm/dashboard';
import type { EventoActividad } from '@/lib/fm/actividad';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';

export const dynamic = 'force-dynamic';

// Cuántas filas de actividad reciente se muestran. La spec (2026-09-21-rework-admin-comercio-design.md,
// "El dashboard") no fija un número: 8 alcanza para ver el pulso del día sin alargar la pantalla —
// más que las 3×5 filas de origen que `actividadReciente` fusiona y recorta.
const LIMITE_ACTIVIDAD = 8;

const fechaCorta = (iso: string) =>
  new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/El_Salvador' }).format(
    new Date(iso),
  );

// Un monto, o "—" si la consulta falló (`null`): nunca un $0.00 falso.
function formatoDinero(valor: number | null): string {
  return valor === null ? '—' : `$${valor.toFixed(2)}`;
}

function formatoConteo(valor: number | null): string {
  return valor === null ? '—' : String(valor);
}

interface FilaActividad {
  icono: string;
  tono: 'acento' | 'menta';
  titulo: string;
  sub: string;
  href: string | null;
}

// Ícono, tono y texto de cada fila de actividad reciente, según su `tipo`
// (EventoActividad, lib/fm/actividad.ts): pago → monto + cuenta, cuenta_nueva → nombre,
// solicitud → plan + cuenta.
function filaDeEvento(e: EventoActividad): FilaActividad {
  switch (e.tipo) {
    case 'pago':
      return {
        icono: 'payments',
        tono: 'menta',
        titulo: `$${e.monto.toFixed(2)}`,
        sub: e.cuentaNombre ?? 'Cuenta',
        // `cuentaId` es nullable en 'pago' (pagos_wompi.cuenta_id puede faltar): sin cuenta, la fila
        // no linkea a ningún lado en vez de armar un href roto con "null".
        href: e.cuentaId ? `/admin/cuentas/${e.cuentaId}` : null,
      };
    case 'cuenta_nueva':
      return {
        icono: 'account_balance',
        tono: 'acento',
        titulo: e.cuentaNombre,
        sub: 'Cuenta nueva',
        href: `/admin/cuentas/${e.cuentaId}`,
      };
    case 'solicitud':
      return {
        icono: 'assignment',
        tono: 'acento',
        titulo: e.planSolicitado,
        sub: e.cuentaNombre ?? 'Cuenta',
        href: `/admin/cuentas/${e.cuentaId}`,
      };
  }
}

export default async function PaginaDashboardFm() {
  // Defensa en profundidad: el layout ya verificó, pero los layouts no se re-ejecutan en navegación
  // del lado del cliente (mismo patrón que toda página de /admin).
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const hoy = hoyEnZona(null);

  // 5 de las 6 métricas de la spec, en un solo Promise.all. `contarCuentasEnRiesgo` (la 6ta, ya
  // escrita en lib/fm/dashboard.ts en la Tarea 6) NO se llama todavía: depende de columnas de la
  // migración 0038 que esta rama no aplicó, y llamarla hoy fallaría. Su tarjeta usa un placeholder
  // más abajo — eso no bloquea que las otras 5 se calculen con datos reales.
  const [ingresos, cartera, solicitudesPendientes, actividad, pagosAtencion] = await Promise.all([
    ingresosDelMes(supabase, hoy),
    tamanoDeCartera(supabase),
    contarSolicitudesPendientes(supabase),
    actividadReciente(supabase, LIMITE_ACTIVIDAD),
    contarPagosAtencion(supabase),
  ]);

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Dashboard</h1>
      </div>

      {/* Layout A (spec): fila de 4 metric-carta arriba. `metric-pila` ya define 2 columnas desde
          760px (app/globals.css); se pisa con un `gridTemplateColumns` propio en el `style` —mismo
          criterio que el `gridColumn: '1 / -1'` de admin/reportes/page.tsx— en vez de sumar una
          clase CSS nueva. */}
      <section
        className="metric-pila reveal d2"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
      >
        {/* Pagos que necesitan atención → /admin/pagos (mismo conteo que el número de la nav,
            contarPagosAtencion). */}
        <Link href="/admin/pagos" className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Pagos que necesitan atención</span>
            <span className="icono" aria-hidden="true">priority_high</span>
          </div>
          <div>
            <div className="metric-valor">{formatoConteo(pagosAtencion)}</div>
            <div className="metric-sub">esperan una decisión</div>
          </div>
        </Link>

        {/* Ingresos del mes: SIN link a propósito (spec) — no existe una pantalla de "ingresos". */}
        <div className="metric-carta menta">
          <div className="metric-etiqueta">
            <span>Ingresos del mes</span>
            <span className="icono" aria-hidden="true">payments</span>
          </div>
          <div>
            <div className="metric-valor">{formatoDinero(ingresos)}</div>
            <div className="metric-sub">cobrado hasta hoy</div>
          </div>
        </div>

        {/* Cuentas vencidas o bloqueadas → /admin/cuentas. Placeholder "—" a propósito: ver el
            comentario de arriba del Promise.all (contarCuentasEnRiesgo depende de la 0038). */}
        <Link href="/admin/cuentas" className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Cuentas vencidas o bloqueadas</span>
            <span className="icono" aria-hidden="true">report</span>
          </div>
          <div>
            <div className="metric-valor">—</div>
            <div className="metric-sub">disponible con la migración 0038</div>
          </div>
        </Link>

        <Link href="/admin/solicitudes" className="metric-carta menta">
          <div className="metric-etiqueta">
            <span>Solicitudes pendientes</span>
            <span className="icono" aria-hidden="true">assignment</span>
          </div>
          <div>
            <div className="metric-valor">{formatoConteo(solicitudesPendientes)}</div>
            <div className="metric-sub">de cambio de plan</div>
          </div>
        </Link>
      </section>

      {/* Fila chica: tamaño de la cartera (cuentas/comercios/clientes). `cartera` es `null` si
          CUALQUIERA de los 3 conteos falló (tamanoDeCartera, lib/fm/dashboard.ts): no se muestra un
          cero falso en ninguno de los tres. */}
      <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 22 }}>
        <p className="titulo-seccion" style={{ marginBottom: 12 }}>Tamaño de la cartera</p>
        {cartera === null ? (
          <p className="admin-error" role="alert">No se pudo calcular el tamaño de la cartera.</p>
        ) : (
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {(
              [
                [cartera.cuentas, 'Cuentas'],
                [cartera.comercios, 'Comercios'],
                [cartera.clientes, 'Clientes'],
              ] as const
            ).map(([valor, etiqueta]) => (
              <div key={etiqueta}>
                <div
                  className="dato-mono"
                  style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}
                >
                  {valor}
                </div>
                <div className="admin-fila-slug" style={{ marginTop: 4 }}>{etiqueta}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Actividad reciente: pagos aplicados, cuentas nuevas y solicitudes, fusionadas por fecha
          (actividadReciente + fusionarActividad, lib/fm/*). `null` ante cualquier fallo de las 3
          consultas de origen — una actividad a medias sería peor que ninguna. */}
      <section className="reveal d4">
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Actividad reciente</p>
        {actividad === null ? (
          <p className="admin-error" role="alert">No se pudo cargar la actividad reciente.</p>
        ) : actividad.length === 0 ? (
          <p className="admin-vacio">Todavía no hay actividad para mostrar.</p>
        ) : (
          <div className="admin-lista">
            {actividad.map((e, i) => {
              const fila = filaDeEvento(e);
              // `EventoActividad` es la forma ya FUSIONADA de las 3 fuentes (fusionarActividad no
              // conserva el id de la fila original) — la key combina tipo + fecha + posición, que
              // alcanza para distinguir filas dentro de esta lista ya ordenada y recortada.
              const key = `${e.tipo}-${e.fecha}-${i}`;
              const contenido = (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <span className={`icono-circulo ${fila.tono}`} aria-hidden="true">
                      <span className="icono">{fila.icono}</span>
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="admin-fila-nombre">{fila.titulo}</div>
                      <div className="admin-fila-slug">
                        {fila.sub} · {fechaCorta(e.fecha)}
                      </div>
                    </div>
                  </div>
                  {fila.href && <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>}
                </>
              );
              return fila.href ? (
                <Link key={key} className="admin-fila" href={fila.href}>
                  {contenido}
                </Link>
              ) : (
                <div key={key} className="admin-fila">
                  {contenido}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
