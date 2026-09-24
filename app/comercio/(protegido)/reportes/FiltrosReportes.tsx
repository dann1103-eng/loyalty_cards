import Link from 'next/link';
import type { ComercioOwner } from '@/lib/reportes/filtrosReportes';
import type { ContextoReportesCargado, FiltrosReportesCargados } from '@/lib/reportes/contextoReportes';
import { FECHA_MINIMA } from '@/lib/reportes/rangoFechas';
import { camposOcultosRango, RUTA_REPORTES } from '@/lib/reportes/urlReportes';
import { filtrosEnPantalla, type ChipFiltro } from '@/lib/reportes/pantallaReportes';

// Los filtros de Reportes (spec 2026-09-23 §1). Server Component y sin JavaScript: todo va por GET, así
// que la URL ES el reporte (se comparte y se guarda). Filas de chips en este orden: período, comercio,
// sucursal, cajero.
//
// Este componente solo arma el markup. Qué filas se dibujan, qué chip está activo, a dónde lleva cada
// uno (urlReportes: conserva lo que no cambia, cambiar de comercio borra sucursal y cajero, todo vuelve
// a la página 1), cuándo se abre el formulario y qué filtro está aplicado sin verse, lo decide
// filtrosEnPantalla (lib/reportes/pantallaReportes.ts), que tiene su prueba y sus mutaciones.
//
// Recibe los filtros YA RESUELTOS: un id ajeno de la URL ya se descartó y no reaparece en ningún
// enlace.

export function FiltrosReportes({
  comercios,
  filtros,
  contexto,
}: {
  comercios: ComercioOwner[];
  filtros: FiltrosReportesCargados;
  contexto: ContextoReportesCargado;
}) {
  const pantalla = filtrosEnPantalla(comercios, filtros, contexto);

  return (
    <section className="reveal d1" style={{ marginBottom: 24 }}>
      <FilaChips id="filtro-periodo" titulo="Período" chips={pantalla.periodo} />
      {pantalla.formularioRango && <FormularioRango filtros={filtros} />}
      {pantalla.comercio && <FilaChips id="filtro-comercio" titulo="Comercio" chips={pantalla.comercio} />}
      {pantalla.sucursal && <FilaChips id="filtro-sucursal" titulo="Sucursal" chips={pantalla.sucursal} />}
      {pantalla.cajero && <FilaChips id="filtro-cajero" titulo="Cajero" chips={pantalla.cajero} />}

      {/* Un filtro aplicado cuya fila no se dibuja (una sola sucursal; un dueño sin cajeros): se dice
          igual, con un enlace para quitarlo. Nunca un filtro aplicado e invisible. */}
      {pantalla.invisibles.map((aviso) => (
        <p key={aviso.clave} className="aviso-contexto" style={{ margin: '14px 0 0' }}>
          <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">filter_alt</span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            Filtrando por {aviso.rotulo}: <strong>{aviso.valor}</strong>
          </span>
          <Link
            href={aviso.hrefQuitar}
            aria-label={`Quitar el filtro de ${aviso.rotulo}`}
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
//
// `filtro-chips-recortados` (globals.css): acá, y solo acá, un chip largo se corta con puntos
// suspensivos. Todo chip que puede cortarse trae su texto entero en `titulo`.
function FilaChips({ id, titulo, chips }: { id: string; titulo: string; chips: ChipFiltro[] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <p id={id} className="admin-fila-slug" style={{ marginBottom: 8 }}>
        {titulo}
      </p>
      <div className="filtro-chips filtro-chips-recortados" role="group" aria-labelledby={id}>
        {chips.map((chip) => (
          <Link
            key={chip.clave}
            className={`filtro-chip${chip.activo ? ' activo' : ''}`}
            href={chip.href}
            aria-current={chip.activo ? 'true' : undefined}
            title={chip.titulo}
          >
            {chip.etiqueta}
          </Link>
        ))}
      </div>
    </div>
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
