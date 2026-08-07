import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSucursales, idsSucursalesPrincipales } from '@/lib/comercio/sucursales';
import {
  reporteSucursales,
  reporteTendencia,
  reporteTopClientes,
  type FilaReporteSucursal,
} from '@/lib/reportes/reportes';
import { sumarTendencias, fusionarTopClientes, resolverFiltrosReportes } from '@/lib/reportes/agregados';
import { listarProgramas } from '@/lib/comercio/programas';
import { describirCosto } from '@/lib/tarjetas/unidadPrograma';

export const dynamic = 'force-dynamic';

const DIAS_TENDENCIA = 14;
const TOP_LIMITE = 5;

// Etiqueta corta dd/mm a partir del `dia` (string "YYYY-MM-DD"). Se parte a mano en vez de `new Date`
// para no arrastrar el desfase de zona horaria (la SQL ya cortó los días en hora de El Salvador).
function etiquetaDia(dia: string): string {
  const [, mm, dd] = dia.split('-');
  return `${dd}/${mm}`;
}

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

// `esPrincipal` viene de afuera: reporte_sucursales (0010) no devuelve es_principal — se cruza con
// el listado de sucursales que la página ya carga.
function CartaSucursal({ fila, esPrincipal }: { fila: FilaReporteSucursal; esPrincipal: boolean }) {
  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>
          {fila.sucursal_nombre ?? 'Sin sucursal'}
          {esPrincipal && <span className="admin-fila-slug" style={{ marginLeft: 8 }}>Principal</span>}
        </h3>
        {fila.sucursal_activa === false && <span className="pastilla pastilla-inactivo">inactiva</span>}
        {fila.sucursal_id === null && <span className="admin-fila-slug">actividad sin asignar</span>}
      </div>
      <div style={{ display: 'flex', gap: 28 }}>
        <Estadistica valor={fila.clientes_unicos} etiqueta="Clientes" />
        <Estadistica valor={fila.acreditaciones} etiqueta="Visitas" />
        <Estadistica valor={fila.canjes} etiqueta="Premios" />
      </div>
    </div>
  );
}

export default async function PaginaReportes({
  searchParams,
}: {
  searchParams: Promise<{ comercio?: string; sucursal?: string }>;
}) {
  // Gate del dueño. La vista es el CONGLOMERADO de sus comercios owner (plan 2026-07-25 §4.7) e
  // IGNORA el switcher del header. Los filtros vienen del querystring (input del cliente): los
  // valida resolverFiltrosReportes (puro, con mutation-tests) ANTES de correr cualquier RPC —
  // ?comercio contra la lista owner, ?sucursal por pertenencia al comercio filtrado. Un id ajeno o
  // inválido cae a "Todo"/"todas".
  const { comercios } = await verifyComercioOwner();
  const params = await searchParams;
  const supabase = createServiceClient();

  // Sucursales del comercio del querystring: solo se cargan si ese id es de un comercio SUYO (así
  // un id ajeno ni siquiera dispara la consulta). Activas e inactivas: el histórico de una sucursal
  // apagada sigue siendo consultable.
  const esComercioPropio = comercios.some((c) => c.comercioId === params.comercio);
  const sucursalesDelComercio = esComercioPropio
    ? (await listarSucursales(supabase, params.comercio!)) ?? []
    : [];
  const { comercio: comercioFiltrado, sucursal: sucursalFiltrada } = resolverFiltrosReportes(
    comercios,
    sucursalesDelComercio,
    params,
  );

  const alcance = comercioFiltrado ? [comercioFiltrado] : comercios;
  // Todo en paralelo: 3 RPC por comercio del alcance + UNA sola consulta para las principales de
  // todos ellos. Las principales van aparte (y no un listarSucursales por comercio) porque
  // reporte_sucursales (0010) no devuelve es_principal y la etiqueta se resuelve cruzando por id:
  // pedirlo comercio por comercio sumaba N round-trips en una página force-dynamic que se abre
  // seguido, y en la vista filtrada repetía exactamente la consulta que ya hizo sucursalesDelComercio.
  const [datos, idsPrincipales] = await Promise.all([
    Promise.all(
      alcance.map(async (c) => {
        const [sucursales, tendencia, top] = await Promise.all([
          reporteSucursales(supabase, c.comercioId),
          reporteTendencia(supabase, c.comercioId, DIAS_TENDENCIA),
          reporteTopClientes(supabase, c.comercioId, TOP_LIMITE),
        ]);
        return { comercio: c, sucursales, tendencia, top };
      }),
    ),
    idsSucursalesPrincipales(
      supabase,
      alcance.map((c) => c.comercioId),
    ),
  ]);

  // Cabecera: con filtro de sucursal, SUS números; si no, la suma del alcance visible.
  const filasVisibles = sucursalFiltrada
    ? datos[0].sucursales.filter((f) => f.sucursal_id === sucursalFiltrada.id)
    : datos.flatMap((d) => d.sucursales);
  const totalVisitas = filasVisibles.reduce((suma, f) => suma + f.acreditaciones, 0);

  // El tipo de CADA comercio del alcance, no uno solo: esta pantalla agrega el conglomerado del
  // dueno y cada negocio puede tener un tipo distinto. Se usa para decir los acumulados en la unidad
  // correcta — en cashback y gift card el contador son CENTAVOS, y un "1250 pts" sobre $12.50 le
  // hace leer mal su negocio.
  const tipoPorComercio = new Map<string, string>(
    await Promise.all(
      alcance.map(async (c): Promise<[string, string]> => {
        const suyos = await listarProgramas(supabase, c.comercioId);
        return [c.comercioId, (suyos ?? []).find((p) => p.esPrincipal)?.tipoTarjeta ?? 'puntos'];
      }),
    ),
  );
  const totalPremios = filasVisibles.reduce((suma, f) => suma + f.canjes, 0);

  const tendencia = sucursalFiltrada ? [] : sumarTendencias(datos.map((d) => d.tendencia));
  const maxDia = Math.max(1, ...tendencia.map((d) => d.acreditaciones + d.canjes));
  const hayActividad = totalVisitas + totalPremios > 0;
  const topGlobal = sucursalFiltrada
    ? []
    : fusionarTopClientes(
        datos.map((d) => ({
          comercioId: d.comercio.comercioId,
          comercioNombre: d.comercio.nombre,
          filas: d.top,
        })),
        TOP_LIMITE,
      );

  // reporte_sucursales arma sus filas desde la ACTIVIDAD (0010), no desde la tabla sucursales: un
  // comercio sin movimientos devuelve 0 filas. Se separan para no repetir el mismo "todavía no hay
  // actividad" una vez por comercio vacío — el ruido crecería justo cuando menos información hay.
  const conActividad = datos.filter((d) => d.sucursales.length > 0);
  const sinActividad = datos.filter((d) => d.sucursales.length === 0);

  const urlComercio = (id?: string) => (id ? `/comercio/reportes?comercio=${id}` : '/comercio/reportes');
  const urlSucursal = (id?: string) =>
    comercioFiltrado
      ? id
        ? `/comercio/reportes?comercio=${comercioFiltrado.comercioId}&sucursal=${id}`
        : urlComercio(comercioFiltrado.comercioId)
      : urlComercio();

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <section className="reveal d1" style={{ marginBottom: 18 }}>
        <h1 className="title" style={{ fontSize: '1.7rem', margin: 0 }}>Reportes</h1>
        <p className="lede" style={{ marginTop: 6 }}>
          {comercios.length > 1
            ? 'Todos tus comercios en un solo lugar. Filtrá por comercio o sucursal.'
            : 'Cómo se mueve tu programa de lealtad por sucursal.'}
        </p>
        {/* Actividad por cajero (Tanda 1). Es la vista que delata al que se sale de la curva: acá
            los números están agregados por sucursal y ahí un cajero queda diluido entre sus
            compañeros. Se lee siempre del comercio ACTIVO (el del switcher del header). */}
        <Link className="btn-borde" style={{ marginTop: 12 }} href="/comercio/reportes/cajeros">
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">badge</span>
          Ver actividad por cajero
        </Link>
      </section>

      {/* Filtros (GET, sin JS): fila de comercios; con uno elegido, fila de sus sucursales. */}
      <section className="reveal d1" style={{ marginBottom: 20 }}>
        <div className="filtro-chips">
          <Link className={`filtro-chip${!comercioFiltrado ? ' activo' : ''}`} href={urlComercio()}>
            Todo
          </Link>
          {comercios.map((c) => (
            <Link
              key={c.comercioId}
              className={`filtro-chip${comercioFiltrado?.comercioId === c.comercioId ? ' activo' : ''}`}
              href={urlComercio(c.comercioId)}
            >
              {c.nombre}
            </Link>
          ))}
        </div>
        {comercioFiltrado && sucursalesDelComercio.length > 0 && (
          <div className="filtro-chips" style={{ marginTop: 8 }}>
            <Link className={`filtro-chip${!sucursalFiltrada ? ' activo' : ''}`} href={urlSucursal()}>
              Todas
            </Link>
            {sucursalesDelComercio.map((s) => (
              <Link
                key={s.id}
                className={`filtro-chip${sucursalFiltrada?.id === s.id ? ' activo' : ''}`}
                href={urlSucursal(s.id)}
              >
                {s.nombre}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Métricas de cabecera (alcance visible). */}
      <section className="metric-pila reveal d2">
        <div className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Visitas acreditadas</span>
            <span className="icono" aria-hidden="true">sensors</span>
          </div>
          <div>
            <div className="metric-valor">{totalVisitas}</div>
            <div className="metric-sub">veces que le sumaste a un cliente</div>
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

      {sucursalFiltrada ? (
        /* Vista por SUCURSAL: su carta + nota (tendencia y top son por comercio — RPC de la 0010;
           crear variantes por sucursal quedó explícitamente fuera de alcance). */
        <section className="reveal d3">
          {filasVisibles.length === 0 ? (
            <p className="admin-vacio">Todavía no hay actividad registrada en {sucursalFiltrada.nombre}.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {filasVisibles.map((f) => (
                <CartaSucursal
                  key={f.sucursal_id ?? 'sin-sucursal'}
                  fila={f}
                  esPrincipal={f.sucursal_id !== null && idsPrincipales.has(f.sucursal_id)}
                />
              ))}
            </div>
          )}
          <p className="nota" style={{ marginTop: 14 }}>
            Al filtrar por sucursal se ocultan la tendencia y el top de clientes: esos reportes solo
            existen por comercio.{' '}
            <Link className="admin-fila-slug" href={urlSucursal()}>Quitar el filtro de sucursal →</Link>
          </p>
        </section>
      ) : (
        <>
          {/* Por comercio (cabecera con el nombre solo cuando hay 2+ en el alcance). Los comercios
              sin actividad NO llevan bloque propio: se nombran juntos en una línea al final. */}
          <section className="reveal d3" style={{ marginBottom: 22 }}>
            {conActividad.length === 0 ? (
              <p className="admin-vacio">
                {alcance.length > 1
                  ? 'Todavía no hay actividad registrada en ninguno de tus comercios.'
                  : 'Todavía no hay actividad registrada.'}
              </p>
            ) : (
              <>
                {conActividad.map((d) => (
                  <div key={d.comercio.comercioId} style={{ marginBottom: 18 }}>
                    <p className="titulo-seccion" style={{ marginBottom: 10 }}>
                      {alcance.length > 1 ? d.comercio.nombre : 'Por sucursal'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {d.sucursales.map((f) => (
                        <CartaSucursal
                          key={f.sucursal_id ?? 'sin-sucursal'}
                          fila={f}
                          esPrincipal={f.sucursal_id !== null && idsPrincipales.has(f.sucursal_id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {sinActividad.length > 0 && (
                  <p className="admin-fila-slug">
                    Sin actividad todavía: {sinActividad.map((d) => d.comercio.nombre).join(', ')}.
                  </p>
                )}
              </>
            )}
          </section>

          {/* Tendencia agregada del alcance. */}
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

          {/* Top de clientes (con etiqueta del comercio cuando el alcance es más de uno). */}
          <section className="reveal d5">
            <p className="titulo-seccion" style={{ marginBottom: 10 }}>Clientes más frecuentes</p>
            {topGlobal.length === 0 ? (
              <p className="admin-vacio">Todavía no hay clientes con visitas.</p>
            ) : (
              <div className="admin-lista">
                {/* key por ID de comercio, no por nombre: comercios.nombre no es unique (0001), y
                    dos homónimos con el mismo cliente colisionarían (ver test de fusionarTopClientes). */}
                {topGlobal.map((c) => (
                  <div key={`${c.comercio_id}-${c.cliente_id}`} className="admin-fila">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span className="icono-circulo acento" aria-hidden="true">
                        <span className="icono">person</span>
                      </span>
                      <div>
                        <div className="admin-fila-nombre">{c.cliente_nombre}</div>
                        <div className="admin-fila-slug">
                          <span className="dato-mono">{c.visitas}</span> visitas
                          {alcance.length > 1 ? ` · ${c.comercio_nombre}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className="admin-fila-slug dato-mono">{describirCosto(tipoPorComercio.get(c.comercio_id) ?? 'puntos', c.puntos_totales)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
