import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ComercioOwner, FiltrosReportes as FiltrosResueltos } from '@/lib/reportes/filtrosReportes';
import type { ContextoReportesCargado } from '@/lib/reportes/contextoReportes';
import type { SucursalListada } from '@/lib/comercio/sucursales';
import type { UsuarioDelComercio } from '@/lib/comercio/cajeros';
import { PERIODOS, ETIQUETA_PERIODO, FECHA_MINIMA } from '@/lib/reportes/rangoFechas';
import { urlReportes, camposOcultosRango, RUTA_REPORTES } from '@/lib/reportes/urlReportes';
import { filasDeChips, filtrosInvisibles, etiquetaCajero } from '@/lib/reportes/pantallaReportes';

// Los filtros de Reportes (spec 2026-09-23 §1). Server Component y sin JavaScript: todo va por GET, así
// que la URL ES el reporte (se comparte y se guarda). Filas de chips en este orden: período, comercio,
// sucursal, cajero. Qué filas se dibujan lo decide filasDeChips, y cada enlace lo arma urlReportes
// (conserva lo que no cambia; cambiar de comercio borra sucursal y cajero; todo vuelve a la página 1).
// Acá no se decide nada: solo se lee lo que devuelven esas funciones puras, que tienen su prueba.
//
// Recibe los filtros YA RESUELTOS: un id ajeno de la URL ya se descartó y no reaparece en ningún
// enlace.

// Lo que devuelve resolverFiltrosReportes con el contexto de cargarContextoReportes: la sucursal y el
// cajero elegidos son filas enteras (nombre, email, esVos), que la pantalla necesita para nombrarlos.
export type FiltrosReportesCargados = FiltrosResueltos<SucursalListada, UsuarioDelComercio>;

export function FiltrosReportes({
  comercios,
  filtros,
  contexto,
}: {
  comercios: ComercioOwner[];
  filtros: FiltrosReportesCargados;
  contexto: ContextoReportesCargado;
}) {
  const filas = filasDeChips(comercios, filtros, contexto);
  // Un filtro aplicado sin fila de chips (una sola sucursal; un dueño sin cajeros): se dice igual.
  const invisibles = filtrosInvisibles(filas, filtros);

  return (
    <section className="reveal d1" style={{ marginBottom: 24 }}>
      <FilaChips id="filtro-periodo" titulo="Período">
        {PERIODOS.map((periodo) => (
          // "Personalizado" también es un enlace: lleva el desde/hasta del período que se está
          // viendo (urlReportes los conserva), así el formulario de abajo abre PRECARGADO y nunca vacío.
          <Chip key={periodo} activo={filtros.periodo === periodo} href={urlReportes(filtros, { periodo })}>
            {ETIQUETA_PERIODO[periodo]}
          </Chip>
        ))}
      </FilaChips>
      {filtros.periodo === 'rango' && <FormularioRango filtros={filtros} />}

      {filas.comercio && (
        <FilaChips id="filtro-comercio" titulo="Comercio">
          <Chip activo={filtros.comercio === null} href={urlReportes(filtros, { comercio: null })}>
            Todo
          </Chip>
          {comercios.map((c) => (
            <Chip
              key={c.comercioId}
              activo={filtros.comercio?.comercioId === c.comercioId}
              href={urlReportes(filtros, { comercio: c.comercioId })}
              titulo={c.nombre}
            >
              {c.nombre}
            </Chip>
          ))}
        </FilaChips>
      )}

      {/* filas.sucursal y filas.cajero son true solo si las listas del contexto son del comercio
          resuelto (filasDeChips lo exige): los ids de estos chips son los que el resolver acepta. */}
      {filas.sucursal && (
        <FilaChips id="filtro-sucursal" titulo="Sucursal">
          <Chip activo={filtros.sucursal === null} href={urlReportes(filtros, { sucursal: null })}>
            Todas
          </Chip>
          {contexto.sucursales.map((s) => (
            <Chip
              key={s.id}
              activo={filtros.sucursal?.id === s.id}
              href={urlReportes(filtros, { sucursal: s.id })}
              titulo={s.nombre}
            >
              {s.nombre}
            </Chip>
          ))}
        </FilaChips>
      )}

      {filas.cajero && (
        <FilaChips id="filtro-cajero" titulo="Cajero">
          <Chip activo={filtros.cajero === null} href={urlReportes(filtros, { cajero: null })}>
            Todos
          </Chip>
          {contexto.usuarios.map((u) => (
            // El email entero en el `title`: el chip corta con puntos suspensivos (globals.css).
            <Chip
              key={u.id}
              activo={filtros.cajero?.id === u.id}
              href={urlReportes(filtros, { cajero: u.id })}
              titulo={u.email}
            >
              {etiquetaCajero(u)}
            </Chip>
          ))}
        </FilaChips>
      )}

      {invisibles.map((aviso) => (
        <p key={aviso.clave} className="aviso-contexto" style={{ margin: '14px 0 0' }}>
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">filter_alt</span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            Filtrando por {aviso.rotulo}: <strong>{aviso.valor}</strong>
          </span>
          <Link
            href={aviso.hrefQuitar}
            style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--acento)', fontWeight: 600 }}
          >
            Quitar
          </Link>
        </p>
      ))}
    </section>
  );
}

// Una fila de chips con su rótulo. El rótulo nombra el grupo para los lectores de pantalla
// (aria-labelledby) y a la vista: con cuatro filas, "Centro" podría ser un comercio o una sucursal.
function FilaChips({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <p id={id} className="admin-fila-slug" style={{ marginBottom: 8 }}>
        {titulo}
      </p>
      <div className="filtro-chips" role="group" aria-labelledby={id}>
        {children}
      </div>
    </div>
  );
}

// `titulo` = el texto entero en el tooltip, para los chips que pueden cortarse (nombres y emails).
function Chip({
  href,
  activo,
  titulo,
  children,
}: {
  href: string;
  activo: boolean;
  titulo?: string;
  children: ReactNode;
}) {
  return (
    <Link
      className={`filtro-chip${activo ? ' activo' : ''}`}
      href={href}
      aria-current={activo ? 'true' : undefined}
      title={titulo}
    >
      {children}
    </Link>
  );
}

// "Personalizado": dos fechas PRECARGADAS con el período que se está viendo (con "Desde siempre" el
// desde es null y el campo abre vacío = sin borde inferior) y los demás filtros en campos ocultos
// (camposOcultosRango: comercio, sucursal, cajero y el orden de la tabla; sin la página, porque cambiar
// el rango vuelve a la 1). Un GET común: sin JavaScript, y la URL resultante se comparte como cualquier
// otra. Las fechas raras (vacías, invertidas, futuras, anteriores a 2000) las corrige el resolver.
function FormularioRango({ filtros }: { filtros: FiltrosReportesCargados }) {
  return (
    <form
      className="panel"
      method="GET"
      action={RUTA_REPORTES}
      style={{ marginTop: 14, padding: '16px 16px 18px' }}
    >
      {camposOcultosRango(filtros).map((campo) => (
        <input key={campo.nombre} type="hidden" name={campo.nombre} value={campo.valor} />
      ))}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 140px' }}>
          <label htmlFor="reportes-desde">Desde</label>
          <input id="reportes-desde" name="desde" type="date" min={FECHA_MINIMA} defaultValue={filtros.desde ?? ''} />
        </div>
        <div className="field" style={{ margin: 0, flex: '1 1 140px' }}>
          <label htmlFor="reportes-hasta">Hasta</label>
          <input id="reportes-hasta" name="hasta" type="date" min={FECHA_MINIMA} defaultValue={filtros.hasta} />
        </div>
        <button className="btn-primary" type="submit" style={{ width: 'auto', flex: '1 1 90px', marginTop: 0 }}>
          Ver
        </button>
      </div>
    </form>
  );
}
