import type { FilaReporteResumen } from '@/lib/reportes/reportes';
import type { FiltrosReportesCargados } from '@/lib/reportes/contextoReportes';
import { sucursalesPorComercio, textoSinActividad } from '@/lib/reportes/pantallaReportes';
import { AvisoBloque } from './AvisoBloque';

// "Por sucursal" (spec 2026-09-23 §2): las cartas de siempre (Clientes, Visitas, Premios), ahora con
// período, sucursal y cajero aplicados, porque salen de las filas de reporte_resumen (todas menos la
// total). Con dos o más comercios en el alcance, agrupadas bajo el nombre de cada uno; los que no
// operaron en el período se nombran juntos en una línea al final (sucursalesPorComercio).
//
// Con una sucursal elegida la SQL ya devuelve solo esa: una carta, o el estado vacío que la nombra
// ("Sin actividad en Centro en este período"), nunca un hueco.
export function PorSucursal({
  filas,
  filtros,
  idsPrincipales,
}: {
  filas: FilaReporteResumen[] | null;
  filtros: FiltrosReportesCargados;
  // reporte_resumen no trae es_principal: se cruza por id con idsSucursalesPrincipales.
  idsPrincipales: ReadonlySet<string>;
}) {
  const varios = filtros.alcance.length >= 2;

  return (
    <section className="reveal d4" style={{ marginBottom: 24 }}>
      {/* h2 con el aspecto de .titulo-seccion (que en el resto del panel va en un <p>): los comercios
          son h3 y las sucursales h4, y la jerarquía no puede saltar un nivel. */}
      <h2 className="titulo-seccion" style={{ marginBottom: 10, fontWeight: 400 }}>
        Por sucursal
      </h2>
      {filas === null ? <AvisoBloque que="las sucursales" /> :<Contenido filas={filas} filtros={filtros} idsPrincipales={idsPrincipales} varios={varios} />}
    </section>
  );
}

function Contenido({
  filas,
  filtros,
  idsPrincipales,
  varios,
}: {
  filas: FilaReporteResumen[];
  filtros: FiltrosReportesCargados;
  idsPrincipales: ReadonlySet<string>;
  varios: boolean;
}) {
  const { conActividad, sinActividad } = sucursalesPorComercio(filas, filtros.alcance);

  if (conActividad.length === 0) {
    return <p className="admin-vacio">{textoSinActividad(filtros)}</p>;
  }

  return (
    <>
      {conActividad.map((bloque) => (
        <div key={bloque.comercio.comercioId} style={{ marginBottom: 18 }}>
          {varios && (
            <h3 className="admin-fila-nombre" style={{ marginBottom: 10 }}>
              {bloque.comercio.nombre}
            </h3>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {bloque.filas.map((fila) => (
              <CartaSucursal
                key={fila.sucursal_id ?? 'sin-sucursal'}
                fila={fila}
                esPrincipal={fila.sucursal_id !== null && idsPrincipales.has(fila.sucursal_id)}
                Titulo={varios ? 'h4' : 'h3'}
              />
            ))}
          </div>
        </div>
      ))}
      {varios && sinActividad.length > 0 && (
        <p className="admin-fila-slug">
          Sin actividad en este período: {sinActividad.map((c) => c.nombre).join(', ')}.
        </p>
      )}
    </>
  );
}

// `Titulo`: h3 bajo "Por sucursal", o h4 cuando van debajo del h3 con el nombre del comercio.
function CartaSucursal({
  fila,
  esPrincipal,
  Titulo,
}: {
  fila: FilaReporteResumen;
  esPrincipal: boolean;
  Titulo: 'h3' | 'h4';
}) {
  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}
      >
        <Titulo className="admin-fila-nombre" style={{ fontSize: '1.05rem', minWidth: 0, overflowWrap: 'anywhere' }}>
          {fila.sucursal_nombre ?? 'Sin sucursal'}
          {esPrincipal && (
            <span className="admin-fila-slug" style={{ marginLeft: 8 }}>
              Principal
            </span>
          )}
        </Titulo>
        {fila.sucursal_activa === false && <span className="pastilla pastilla-inactivo">inactiva</span>}
        {fila.sucursal_id === null && <span className="admin-fila-slug">actividad sin asignar</span>}
      </div>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <Estadistica valor={fila.clientes_unicos} etiqueta="Clientes" />
        <Estadistica valor={fila.operaciones} etiqueta="Visitas" />
        <Estadistica valor={fila.canjes} etiqueta="Premios" />
      </div>
    </div>
  );
}

function Estadistica({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div>
      <div className="dato-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}>
        {valor}
      </div>
      <div className="admin-fila-slug" style={{ marginTop: 4 }}>
        {etiqueta}
      </div>
    </div>
  );
}
