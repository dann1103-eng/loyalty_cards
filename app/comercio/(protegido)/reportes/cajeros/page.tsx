import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { reporteCajeros } from '@/lib/reportes/reportes';
import { resolverRangoFechas, rangoUltimosDias } from '@/lib/reportes/rangoFechas';
import { ZONA_HORARIA_DEFAULT, etiquetaZonaHoraria } from '@/lib/comercio/zonasHorarias';
import { listarCajeros } from '@/lib/comercio/cajeros';
import { listarProgramas } from '@/lib/comercio/programas';
import { unidadPrograma, describirCosto } from '@/lib/tarjetas/unidadPrograma';

export const dynamic = 'force-dynamic';

// Reporte por cajero: el que realmente delata la anomalía. Los otros reportes agregan por sucursal
// o por cliente, y ahí un cajero que regala sellos queda diluido entre sus compañeros.
//
// Filtros por GET, sin JavaScript: un <form method="GET"> con dos <input type="date">, igual que el
// buscador del directorio de clientes. Así el rango queda en la URL y el dueño puede compartirla o
// guardarla.

export default async function PaginaReporteCajeros({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { comercioId, nombre } = await verifyComercioOwner();
  const { desde: desdeCrudo, hasta: hastaCrudo } = await searchParams;

  const supabase = createServiceClient();

  const { data: comercio } = await supabase
    .from('comercios')
    .select('zona_horaria, pedir_monto_compra')
    .eq('id', comercioId)
    .maybeSingle();
  const zona = comercio?.zona_horaria ?? ZONA_HORARIA_DEFAULT;

  // El tipo sale del programa PRINCIPAL, no de `comercios.tipo_tarjeta` (legada desde la 0024).
  //
  // Y no es cosmetico: `puntos_otorgados` es el MISMO contador universal que puntos_actuales, asi
  // que en un comercio de cashback o gift card son CENTAVOS. Diciendo "1250 puntos" sobre $12.50, la
  // pantalla que existe para detectar a un cajero que regala cosas le muestra al dueno un numero en
  // la unidad equivocada — justo donde tiene que juzgar si algo esta mal.
  const programas = await listarProgramas(supabase, comercioId);
  const tipoPrincipal = (programas ?? []).find((p) => p.esPrincipal)?.tipoTarjeta ?? 'puntos';
  const unidad = unidadPrograma(tipoPrincipal);

  // Sin filtro explícito, los últimos 30 días en la zona del comercio.
  const pedido = resolverRangoFechas(desdeCrudo, hastaCrudo);
  const porDefecto = rangoUltimosDias(new Date(), 30, zona);
  const rango = {
    desde: pedido.desde ?? porDefecto.desde,
    hasta: pedido.hasta ?? porDefecto.hasta,
  };

  const filas = await reporteCajeros(supabase, comercioId, rango.desde, rango.hasta);

  // Los cajeros sin NINGUNA actividad no aparecen en el RPC (que se arma desde el ledger). Se
  // cruzan acá para mostrarlos en cero: "este cajero no registró nada en el rango" es información,
  // no ausencia de información.
  const cajeros = await listarCajeros(supabase, comercioId);
  const conActividad = new Set((filas ?? []).map((f) => f.cajero_usuario_id));
  const sinActividad = (cajeros ?? []).filter((c) => !conActividad.has(c.id));

  const totalForzadas = (filas ?? []).reduce((suma, f) => suma + f.forzadas, 0);
  const totalAjustes = (filas ?? []).reduce((suma, f) => suma + f.ajustes, 0);

  return (
    <main className="admin-main" style={{ maxWidth: 900 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Actividad por cajero</h1>
        <Link className="admin-fila-slug" href="/comercio/reportes">← Reportes</Link>
      </div>

      <p className="admin-fila-slug reveal d1" style={{ marginTop: -8 }}>
        {nombre} · horario de {etiquetaZonaHoraria(zona)}
      </p>

      <form className="panel reveal d2" method="GET" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, flex: '1 1 150px' }}>
            <label htmlFor="desde">Desde</label>
            <input id="desde" name="desde" type="date" defaultValue={rango.desde ?? ''} />
          </div>
          <div className="field" style={{ margin: 0, flex: '1 1 150px' }}>
            <label htmlFor="hasta">Hasta</label>
            <input id="hasta" name="hasta" type="date" defaultValue={rango.hasta ?? ''} />
          </div>
          <button className="btn-primary" type="submit">Ver</button>
        </div>
      </form>

      {/* `null` NO es lista vacía: ver el comentario de reporteCajeros. Una tabla vacía por un error
          de consulta diría "ningún cajero hizo nada raro", que es la conclusión opuesta a la verdad. */}
      {filas === null ? (
        <p className="admin-error reveal d3" role="alert" style={{ marginTop: 18 }}>
          No se pudo cargar la actividad por cajero. Recarga la página.
        </p>
      ) : (
        <>
          {(totalForzadas > 0 || totalAjustes > 0) && (
            <p className="nota reveal d3" style={{ marginTop: 18 }}>
              En este rango hubo <strong style={{ color: 'var(--acento)' }}>{totalForzadas}</strong>{' '}
              acreditación(es) autorizada(s) por encima del límite y{' '}
              <strong style={{ color: 'var(--acento)' }}>{totalAjustes}</strong> corrección(es).
              Tocá el historial de un cliente para ver el motivo de cada una.
            </p>
          )}

          <div className="admin-lista reveal d3" style={{ marginTop: 18 }}>
            {filas.length === 0 && sinActividad.length === 0 ? (
              <p className="admin-vacio">No hay actividad registrada en este rango.</p>
            ) : (
              filas.map((f) => (
                <div key={f.cajero_usuario_id ?? 'sin-cajero'} className="admin-fila" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="admin-fila-nombre">
                      {f.cajero_email ?? 'Sin cajero registrado'}
                      {f.cajero_activo === false && (
                        <span className="admin-fila-slug" style={{ marginLeft: 8 }}>(dado de baja)</span>
                      )}
                    </div>
                    <div className="admin-fila-slug">
                      <span className="dato-mono">{f.acreditaciones}</span> acreditaciones ·{' '}
                      <span className="dato-mono">{describirCosto(tipoPrincipal, f.puntos_otorgados)}</span> ·{' '}
                      <span className="dato-mono">{f.clientes_unicos}</span> clientes ·{' '}
                      <span className="dato-mono">{f.canjes}</span> canjes
                    </div>
                    {comercio?.pedir_monto_compra && (
                      <div className="admin-fila-slug">
                        Vendió <span className="dato-mono">${Number(f.monto_total).toFixed(2)}</span>
                        {/* "cuánto vendió por cada sello" solo tiene sentido donde la unidad es una
                            COSA que se cuenta. En cashback y gift card el contador son centavos, y
                            dividir dólares vendidos entre centavos devueltos da un número que no
                            significa nada — peor que no mostrarlo, porque parece un dato. */}
                        {unidad && f.puntos_otorgados > 0 && (
                          <>
                            {' '}· <span className="dato-mono">
                              ${(Number(f.monto_total) / f.puntos_otorgados).toFixed(2)}
                            </span> por {unidad.singular}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Lo que hay que mirar: forzadas y ajustes destacados. Cero pasa desapercibido a
                      propósito; lo que no es cero tiene que saltar a la vista. */}
                  <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
                    <div
                      className="admin-fila-nombre dato-mono"
                      style={{ color: f.forzadas > 0 ? 'var(--acento)' : undefined }}
                    >
                      {f.forzadas} forzadas
                    </div>
                    <div
                      className="admin-fila-slug dato-mono"
                      style={{ color: f.ajustes > 0 ? 'var(--acento)' : undefined }}
                    >
                      {f.ajustes} correcciones
                      {f.ajustes > 0 && ` (${f.puntos_ajustados})`}
                    </div>
                  </div>
                </div>
              ))
            )}

            {sinActividad.map((c) => (
              <div key={c.id} className="admin-fila">
                <div className="admin-fila-nombre" style={{ opacity: 0.6 }}>{c.email}</div>
                <div className="admin-fila-slug">Sin actividad en el rango</div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
