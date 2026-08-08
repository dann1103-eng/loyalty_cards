import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { resumenPlan, etiquetaDePlan } from '@/lib/comercios/planCuenta';
import { listarCobros } from '@/lib/comercios/cobros';
import { PLANES } from '@/lib/comercios/cuentas';
import FormularioSolicitud from './FormularioSolicitud';
import BotonesSubirPlan from './BotonesSubirPlan';
import { cuentaDelComercio } from './actions';

export const dynamic = 'force-dynamic';

// Autogestión de plan del dueño (migración 0017): qué plan tiene, cuánto de su cupo usa, qué se le
// ha cobrado, y un canal para pedir un cambio.
//
// El cupo que se muestra es el MISMO que aplica el bloqueo al crear un comercio o una sucursal
// (comercios + sucursales no principales, ver cupoDeCuenta). Mostrar un número distinto haría que
// el dueño viera cupo libre que el sistema después le niega.

export default async function PaginaPlan() {
  const { comercioId, nombre } = await verifyComercioOwner();

  const cuentaId = await cuentaDelComercio(comercioId);
  if (!cuentaId) {
    return (
      <main className="admin-main" style={{ maxWidth: 640 }}>
        <div className="admin-encabezado reveal d1">
          <h1 className="title" style={{ margin: 0 }}>Mi plan</h1>
          <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
        </div>
        <p className="admin-vacio">
          Tu comercio todavía no está asociado a una cuenta. Escribinos y lo resolvemos.
        </p>
      </main>
    );
  }

  const supabase = createServiceClient();
  const [resumen, cobros] = await Promise.all([
    resumenPlan(supabase, cuentaId),
    listarCobros(supabase, cuentaId),
  ]);

  if (!resumen) {
    return (
      <main className="admin-main" style={{ maxWidth: 640 }}>
        <p className="admin-error" role="alert">No se pudo cargar tu plan. Recargá la página.</p>
      </main>
    );
  }

  const detalle = PLANES.find((p) => p.valor === resumen.plan);
  const sinTope = resumen.limite === null;
  const lleno = !sinTope && resumen.usadas >= resumen.limite!;

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));

  return (
    <main className="admin-main" style={{ maxWidth: 720 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Mi plan</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <section className="panel reveal d2" style={{ marginTop: 0 }}>
        <p className="admin-fila-slug" style={{ marginTop: 0 }}>{nombre}</p>
        <p className="metric-valor" style={{ fontSize: '1.8rem', marginTop: 4, color: 'var(--acento)' }}>
          {resumen.etiquetaPlan}
        </p>
        {resumen.montoMensual !== null && (
          <p className="admin-fila-slug">
            <span className="dato-mono">${resumen.montoMensual}</span> al mes
            {resumen.licenciaActivaDesde && ` · desde ${fecha(resumen.licenciaActivaDesde)}`}
          </p>
        )}
        <p className="admin-fila-slug">
          Estado:{' '}
          <span className={`pastilla ${resumen.licenciaEstado === 'activo' ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
            {resumen.licenciaEstado === 'activo' ? 'Activa' : 'Inactiva'}
          </span>
        </p>

        <div style={{ marginTop: 16 }}>
          <p className="titulo-seccion" style={{ marginBottom: 4 }}>Tu consumo</p>
          <p className="admin-fila-nombre dato-mono" style={{ color: lleno ? 'var(--acento)' : undefined }}>
            {resumen.usadas} {sinTope ? 'negocios y sucursales' : `de ${resumen.limite}`}
          </p>
          {/* Se explica QUÉ cuenta: es la pregunta que el dueño hace siempre, y la respuesta no es
              obvia — la sucursal principal no consume cupo. */}
          <p className="admin-fila-slug">
            Cuenta tus negocios más las sucursales adicionales. La sucursal principal de cada negocio
            no consume cupo.
          </p>
          {lleno && (
            <p className="alerta" role="alert" style={{ marginTop: 10 }}>
              Llegaste al tope de tu plan. Para agregar otro negocio o sucursal necesitás subir de plan.
            </p>
          )}
        </div>

        {detalle && (
          <p className="admin-fila-slug" style={{ marginTop: 14 }}>
            {detalle.etiqueta} incluye{' '}
            {detalle.limiteSugerido === null
              ? 'negocios y sucursales sin límite'
              : `hasta ${detalle.limiteSugerido} negocio(s) o sucursal(es)`}.
          </p>
        )}
      </section>

      {/* Subir es INMEDIATO y va primero: es lo que el dueño viene a hacer cuando llega acá
          bloqueado por su tope. Se oculta mientras hay una solicitud pendiente para no dejarlo con
          dos caminos abiertos a la vez sobre lo mismo. */}
      {!resumen.solicitudPendiente && (
        <div className="reveal d3" style={{ marginTop: 18 }}>
          <BotonesSubirPlan planActual={resumen.plan} />
        </div>
      )}

      {resumen.solicitudPendiente ? (
        <section className="panel reveal d3" style={{ marginTop: 18, borderColor: 'var(--acento)' }}>
          <p className="titulo-seccion" style={{ marginTop: 0 }}>Solicitud en revisión</p>
          <p className="admin-fila-slug">
            Pediste pasar de <strong>{etiquetaDePlan(resumen.solicitudPendiente.planActual)}</strong> a{' '}
            <strong>{etiquetaDePlan(resumen.solicitudPendiente.planSolicitado)}</strong> el{' '}
            {fecha(resumen.solicitudPendiente.creadaEn)}.
          </p>
          {resumen.solicitudPendiente.motivo && (
            <p className="admin-fila-slug" style={{ fontStyle: 'italic' }}>
              “{resumen.solicitudPendiente.motivo}”
            </p>
          )}
          <p className="nota" style={{ marginBottom: 0 }}>Te avisamos apenas la revisemos.</p>
        </section>
      ) : (
        <div className="reveal d3" style={{ marginTop: 18 }}>
          <FormularioSolicitud planActual={resumen.plan} />
        </div>
      )}

      <section className="reveal d4" style={{ marginTop: 22 }}>
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Cobros</p>
        {/* `null` no es lista vacía: decirle "no te hemos cobrado nada" por un fallo de consulta
            sería peor que mostrar un error. */}
        {cobros === null ? (
          <p className="admin-error" role="alert">No se pudieron cargar los cobros. Recargá la página.</p>
        ) : cobros.length === 0 ? (
          <p className="admin-vacio">Todavía no hay cobros registrados.</p>
        ) : (
          <div className="admin-lista">
            {cobros.map((c) => (
              <div key={c.id} className="admin-fila">
                <div>
                  <div className="admin-fila-nombre">
                    <span className="dato-mono">${c.monto.toFixed(2)}</span>
                    <span className={`pastilla ${c.estado === 'pagado' ? 'pastilla-activo' : 'pastilla-inactivo'}`} style={{ marginLeft: 10 }}>
                      {c.estado === 'pagado' ? 'Pagado' : c.estado === 'anulado' ? 'Anulado' : 'Pendiente'}
                    </span>
                  </div>
                  <div className="admin-fila-slug">
                    {fecha(c.periodoDesde)} — {fecha(c.periodoHasta)}
                    {c.pagadoEn && ` · pagado el ${fecha(c.pagadoEn)}`}
                    {c.metodo && ` · ${c.metodo}`}
                  </div>
                </div>
                <Link className="btn-borde" href={`/comercio/plan/comprobante/${c.id}`}>
                  Comprobante
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
