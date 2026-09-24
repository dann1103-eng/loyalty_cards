import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { idsSucursalesPrincipales } from '@/lib/comercio/sucursales';
import { leerParametrosReportes } from '@/lib/reportes/parametrosReportes';
import { cargarContextoReportes } from '@/lib/reportes/contextoReportes';
import { resolverFiltrosReportes } from '@/lib/reportes/filtrosReportes';
import { filtrosRpc, reporteClientes, reporteResumen, reportePorDia } from '@/lib/reportes/reportes';
import { urlExcelReportes } from '@/lib/reportes/urlReportes';
import { totalesDelResumen, type TotalesResumen } from '@/lib/reportes/pantallaReportes';
import { FiltrosReportes } from './FiltrosReportes';
import { PorDia } from './PorDia';
import { PorSucursal } from './PorSucursal';
import { TablaClientes } from './TablaClientes';
import { AvisoBloque } from './AvisoBloque';

export const dynamic = 'force-dynamic';

// Reportes del dueño (spec 2026-09-23 §1 y §2): el CONGLOMERADO de sus comercios owner (ignora el
// switcher del header, spec 2026-07-25 §4.7), filtrable por período, comercio, sucursal y cajero en
// TODOS sus bloques. Los filtros van por GET y sin JavaScript: la URL es el reporte.
//
// El flujo es el de la cabecera de lib/reportes/contextoReportes.ts, el MISMO que la ruta del Excel,
// para que la pantalla y el archivo filtren igual:
//   gate → leerParametrosReportes → cargarContextoReportes → resolverFiltrosReportes → filtrosRpc.
// Los ids de la URL (input del cliente) se validan en resolverFiltrosReportes ANTES de correr ninguna
// RPC: un comercio que no es suyo, o una sucursal o un cajero de otro comercio, caen a su default.
//
// Toda decisión que no es puro markup vive en funciones puras con prueba (lib/reportes/
// pantallaReportes.ts y urlReportes.ts): el repo no tiene pruebas de componentes.
export default async function PaginaReportes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Gate del dueño FUERA de cualquier try/catch: redirect() funciona lanzando NEXT_REDIRECT.
  const sesion = await verifyComercioOwner();
  const parametros = leerParametrosReportes(await searchParams);
  const supabase = createServiceClient();
  const varios = sesion.comercios.length >= 2;

  const cargado = await cargarContextoReportes(supabase, sesion, parametros);
  if (!cargado.ok) {
    // Sin el contexto no se puede validar la sucursal ni el cajero de la URL: resolver con listas
    // vacías los descartaría EN SILENCIO y la pantalla mostraría números sin filtrar como si fueran
    // los filtrados. Un aviso y ningún número (contextoReportes.ts).
    console.error('[reportes] no se pudo cargar el contexto de los filtros:', cargado.error);
    return (
      <main className="admin-main" style={{ maxWidth: 640 }}>
        <Encabezado varios={varios} urlExcel={null} />
        <p className="admin-error reveal d2" role="alert">
          No pudimos cargar los filtros. Recargá la página.
        </p>
      </main>
    );
  }

  const filtros = resolverFiltrosReportes(sesion.comercios, parametros, cargado.contexto, new Date());
  const rpc = filtrosRpc(filtros);

  // En paralelo: el resumen (cabecera y cartas por sucursal), la serie en modo 'auto' (por día, o por
  // mes si el tramo pasa de 62 días), la página de clientes que pide la URL (con su orden; más allá del
  // final, la SQL devuelve la última) y las principales del alcance para la etiqueta "Principal"
  // (reporte_resumen no trae es_principal; si esa consulta falla, la etiqueta no sale: es cosmética).
  const [resumen, porDia, clientes, idsPrincipales] = await Promise.all([
    reporteResumen(supabase, rpc),
    reportePorDia(supabase, rpc, 'auto'),
    reporteClientes(supabase, rpc, { modo: 'pagina', pagina: filtros.pagina, orden: filtros.orden, dir: filtros.dir }),
    idsSucursalesPrincipales(
      supabase,
      filtros.alcance.map((c) => c.comercioId),
    ),
  ]);

  // La cabecera sale de la fila `es_total`. La 0040 la devuelve SIEMPRE (con ceros si no hubo nada):
  // si falta, es un contrato roto y se trata como un error del bloque, no como ceros.
  const totales = resumen ? totalesDelResumen(resumen.filas) : null;
  if (resumen && !totales) {
    console.error('[reportes] reporte_resumen respondió sin la fila total (contrato de la 0040)');
  }

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <Encabezado varios={varios} urlExcel={urlExcelReportes(filtros)} />

      <FiltrosReportes comercios={sesion.comercios} filtros={filtros} contexto={cargado.contexto} />

      <Cabecera totales={totales} />

      <PorDia filas={porDia?.filas ?? null} totales={totales} />

      <PorSucursal filas={resumen?.filas ?? null} filtros={filtros} idsPrincipales={idsPrincipales} />

      <TablaClientes pagina={clientes} filtros={filtros} />
    </main>
  );
}

// Título, bajada y los dos botones. `urlExcel` null = no hay filtros resueltos (el contexto no cargó):
// sin filtros no hay qué descargar.
function Encabezado({ varios, urlExcel }: { varios: boolean; urlExcel: string | null }) {
  return (
    <section className="reveal d1" style={{ marginBottom: 8 }}>
      <h1 className="title" style={{ fontSize: '1.7rem', margin: 0 }}>
        Reportes
      </h1>
      <p className="lede" style={{ marginTop: 6 }}>
        {varios
          ? 'Todos tus comercios en un solo lugar. Filtrá por período, comercio, sucursal o cajero.'
          : 'Cómo se mueve tu programa de lealtad. Elegí el período y filtrá lo que quieras mirar.'}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
        {/* <a download> y NUNCA <Link>: el destino es un Route Handler que devuelve un archivo, y el
            prefetch de Link lo EJECUTARÍA (armar el Excel entero) en cada vista de esta página. El
            atributo `download` es además lo que le dice a la regla de lint de Next que esto es una
            descarga y no un enlace interno mal hecho (como el CSV de clientes/page.tsx). La URL lleva
            los filtros de la vista, sin orden ni página (urlExcelReportes). */}
        {urlExcel && (
          <a className="btn-borde" href={urlExcel} download>
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">
              download
            </span>
            Descargar Excel
          </a>
        )}
        {/* Actividad por cajero (Tanda 1): sigue como antes, del comercio ACTIVO y con su propio rango.
            El detalle por cajero con todos estos filtros está en la hoja Cajeros del Excel y en el
            filtro de cajero de esta pantalla (spec §2). */}
        <Link className="btn-borde" href="/comercio/reportes/cajeros">
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">
            badge
          </span>
          Ver actividad por cajero
        </Link>
      </div>
    </section>
  );
}

// Visitas, Premios y Clientes del alcance y el período, de la fila total del resumen. Clientes es la
// cuenta DISTINTA (quien fue a dos sucursales, o tiene tarjeta en dos comercios, cuenta 1). Tres cartas
// con .metric-pila.tres (globals.css): la pila de dos columnas la siguen usando el panel y el admin.
function Cabecera({ totales }: { totales: TotalesResumen | null }) {
  if (totales === null) {
    return (
      <section className="reveal d2" style={{ marginBottom: 26 }}>
        <AvisoBloque que="los totales" />
      </section>
    );
  }
  return (
    <section className="metric-pila tres reveal d2">
      <div className="metric-carta naranja">
        <div className="metric-etiqueta">
          <span>Visitas</span>
          <span className="icono" aria-hidden="true">
            sensors
          </span>
        </div>
        <div>
          <div className="metric-valor">{totales.visitas}</div>
          {/* "Visitas" (decisión de Daniel, spec "Rótulo"); la cuenta es la de la 0033: acreditaciones,
              usos y renovaciones. El subtítulo que la explica se conserva. */}
          <div className="metric-sub">veces que atendiste a un cliente</div>
        </div>
      </div>
      <div className="metric-carta menta">
        <div className="metric-etiqueta">
          <span>Premios</span>
          <span className="icono" aria-hidden="true">
            redeem
          </span>
        </div>
        <div>
          <div className="metric-valor">{totales.premios}</div>
          <div className="metric-sub">recompensas entregadas</div>
        </div>
      </div>
      <div className="metric-carta">
        <div className="metric-etiqueta">
          <span>Clientes</span>
          <span className="icono" aria-hidden="true">
            group
          </span>
        </div>
        <div>
          <div className="metric-valor">{totales.clientes}</div>
          <div className="metric-sub">con al menos una visita o premio</div>
        </div>
      </div>
    </section>
  );
}
