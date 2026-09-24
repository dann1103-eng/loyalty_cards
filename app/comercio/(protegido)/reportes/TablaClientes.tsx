import Link from 'next/link';
import type { FilaReporteCliente } from '@/lib/reportes/reportes';
import type { PaginaPorOffset } from '@/lib/reportes/paginar';
import type { FiltrosReportesCargados } from '@/lib/reportes/contextoReportes';
import {
  estadoTablaClientes,
  type ClaveColumnaClientes,
  type ColumnaTablaClientes,
  type FilaTablaClientes,
} from '@/lib/reportes/pantallaReportes';
import { AvisoBloque } from './AvisoBloque';

// "Clientes" (spec 2026-09-23 §3), en lugar del top 5 que había: una fila por (comercio, cliente) con
// actividad en el alcance y el período, ordenable tocando el encabezado y paginada de a 50 en SQL.
//
// Este componente solo arma el markup. Qué se dibuja (aviso, vacío o tabla), qué columnas, qué
// encabezado enlaza y a dónde, su aria-sort, el texto de cada celda (unidad y zona de SU comercio), el
// pie y los destinos de Anterior/Siguiente los decide estadoTablaClientes (lib/reportes/
// pantallaReportes.ts), con prueba y mutación.
//
// Encabezados y celdas salen de la MISMA lista de columnas, así que no pueden desalinearse; cada una
// lleva `data-columna` con su clave, y el CSS (globals.css, "tabla de clientes") la fija, la alinea o
// la deja partir renglón por esa clave y no por su posición. A 375 px la tabla scrollea DENTRO de
// .tabla-marco con la columna Cliente fija: la página no scrollea de costado.
export function TablaClientes({
  pagina,
  filtros,
}: {
  // Lo que devolvió reporteClientes en modo 'pagina'; null = la lectura falló.
  pagina: PaginaPorOffset<FilaReporteCliente> | null;
  filtros: FiltrosReportesCargados;
}) {
  const estado = estadoTablaClientes(pagina, filtros);

  return (
    <section className="reveal d5" style={{ marginBottom: 24 }}>
      {/* h2 con el aspecto de .titulo-seccion, como "Por sucursal". Nombra también la tabla y su marco
          (aria-labelledby): un encabezado visible en vez de un <caption> escondido. */}
      <h2 id="titulo-clientes" className="titulo-seccion" style={{ marginBottom: 10, fontWeight: 400 }}>
        Clientes
      </h2>
      {estado.tipo === 'error' && <AvisoBloque que="la lista de clientes" />}
      {estado.tipo === 'vacio' && (
        <p className="admin-vacio">Todavía no hay clientes con actividad en este período.</p>
      )}
      {estado.tipo === 'tabla' && (
        <>
          {/* tabIndex: el marco scrollea de costado, y sin foco un teclado no llega a las columnas que
              quedan afuera (las celdas no son enfocables). role + nombre: al enfocarlo, el lector de
              pantalla dice qué es. */}
          <div className="tabla-marco" tabIndex={0} role="region" aria-labelledby="titulo-clientes">
            <table className="tabla-clientes" aria-labelledby="titulo-clientes">
              <thead>
                <tr>
                  {estado.columnas.map((columna) => (
                    <Encabezado key={columna.clave} columna={columna} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {estado.filas.map((fila) => (
                  <tr key={fila.clave}>
                    {estado.columnas.map((columna) => (
                      <Celda key={columna.clave} clave={columna.clave} fila={fila} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="tabla-paginas" aria-label="Páginas de la lista de clientes">
            <p className="admin-fila-slug">{estado.pie}</p>
            {(estado.hrefAnterior || estado.hrefSiguiente) && (
              <div className="tabla-paginas-enlaces">
                {estado.hrefAnterior && (
                  <Link className="btn-borde" href={estado.hrefAnterior} rel="prev">
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">
                      chevron_left
                    </span>
                    Anterior
                  </Link>
                )}
                {estado.hrefSiguiente && (
                  <Link className="btn-borde" href={estado.hrefSiguiente} rel="next">
                    Siguiente
                    <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">
                      chevron_right
                    </span>
                  </Link>
                )}
              </div>
            )}
          </nav>
        </>
      )}
    </section>
  );
}

// Un encabezado de columna. Con `href` es un enlace que ordena (tocar la activa la invierte) y el <th>
// lleva su aria-sort: 'ascending'/'descending' en la activa, 'none' en las demás que se pueden
// ordenar. Sin `href` (Comercio; Acumulado con unidades mezcladas o sin contador) es texto y no lleva
// aria-sort: por esa columna no se ordena.
function Encabezado({ columna }: { columna: ColumnaTablaClientes }) {
  if (columna.href === null) {
    return (
      <th scope="col" data-columna={columna.clave}>
        {columna.titulo}
      </th>
    );
  }
  const icono =
    columna.ariaSort === 'ascending' ? 'arrow_upward' : columna.ariaSort === 'descending' ? 'arrow_downward' : 'unfold_more';
  return (
    <th scope="col" data-columna={columna.clave} aria-sort={columna.ariaSort}>
      <Link href={columna.href}>
        {columna.titulo}
        <span className="icono" aria-hidden="true">
          {icono}
        </span>
      </Link>
    </th>
  );
}

// La celda de una columna en una fila. La de Cliente es el encabezado de su fila (<th scope="row">):
// al recorrer la tabla, el lector de pantalla dice de quién es cada número.
function Celda({ clave, fila }: { clave: ClaveColumnaClientes; fila: FilaTablaClientes }) {
  switch (clave) {
    case 'cliente':
      return (
        <th scope="row" data-columna="cliente">
          <div className="admin-fila-nombre">{fila.cliente}</div>
          <div className="admin-fila-slug dato-mono">{fila.telefono}</div>
        </th>
      );
    case 'comercio':
      return <td data-columna="comercio">{fila.comercio}</td>;
    case 'visitas':
      return <td data-columna="visitas">{fila.visitas}</td>;
    case 'acumulado':
      return <td data-columna="acumulado">{fila.acumulado}</td>;
    case 'premios':
      return <td data-columna="premios">{fila.premios}</td>;
    case 'ultima':
      return (
        <td data-columna="ultima">{fila.ultima && <time dateTime={fila.ultimaInstante}>{fila.ultima}</time>}</td>
      );
  }
}
