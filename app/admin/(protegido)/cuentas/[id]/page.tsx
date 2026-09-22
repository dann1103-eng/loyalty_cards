import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { cupoDeCuenta } from '@/lib/comercios/cuentas';
import FormularioCuenta from '../FormularioCuenta';
import FormularioVincular from '../FormularioVincular';
import BotonEliminarCuenta from '../BotonEliminarCuenta';
import FormularioComercio from '../../comercios/FormularioComercio';
import {
  accionActualizarCuenta,
  accionEliminarCuenta,
  accionVincularComercio,
  accionRegistrarCobro,
  accionMarcarCobroPagado,
  accionCrearComercioDeCuenta,
  accionPedirPago,
  accionAnularCobro,
  accionCambiarModoCobranza,
  accionPosponerPago,
  accionPerdonarCiclo,
} from '../actions';
import { listarCobros, listarPeriodosPagados, METODO_WOMPI } from '@/lib/comercios/cobros';
import { describirPeriodo } from '@/lib/comercios/pagosAdmin';
import { etiquetaDePlan } from '@/lib/comercios/planCuenta';
import { estadoDelPeriodo } from '@/lib/comercios/prorrateo';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import FormularioCobro from './FormularioCobro';
import MarcarPagado from './MarcarPagado';
import FormularioPedirPago from './FormularioPedirPago';
import BotonAnularCobro from './BotonAnularCobro';
import ControlesCobranzaFutura from './ControlesCobranzaFutura';

export const dynamic = 'force-dynamic';

// Las 4 pestañas de la ficha de cuenta (spec 2026-09-21-rework-admin-comercio-design.md, "La ficha
// de cuenta, con pestañas"). El contenido de cada una es el que YA existía en esta página, solo
// reagrupado — ninguna consulta ni Server Action cambió.
const PESTANAS = [
  { id: 'datos', etiqueta: 'Datos' },
  { id: 'negocios', etiqueta: 'Negocios' },
  { id: 'cobros', etiqueta: 'Cobros' },
  { id: 'cobranza', etiqueta: 'Cobranza' },
] as const;
type PestanaId = (typeof PESTANAS)[number]['id'];
const IDS_PESTANA: readonly string[] = PESTANAS.map((p) => p.id);

// La migración 0038 (cuentas_comercio.cobranza / cobranza_desde / cobranza_pospuesta_hasta, spec
// 2026-09-21-cobranza-design.md) todavía NO está aplicada contra la base real: sin esas columnas,
// estadoEfectivo() no se puede calcular acá sin que la consulta de la cuenta falle. Por eso este
// flag queda en `false` a propósito, y por eso el default de la pestaña activa (abajo) siempre cae
// en 'datos' hoy. Cuando la Tarea 11 aplique la migración, este flag (o el `esUrgente` que lo usa)
// se reemplaza por una lectura real: estadoEfectivo({ ...cuenta, periodosPagados, hoy }).tipo ===
// 'vencida' | 'bloqueada' — es un cambio de una línea, no un rediseño.
const MIGRACION_0038_APLICADA = false;

export default async function PaginaEditarCuenta({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await verifyFmAdmin();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;

  const supabase = createServiceClient();
  const { data: cuenta, error } = await supabase
    .from('cuentas_comercio')
    .select('id, nombre, limite_negocios, plan, licencia_estado, licencia_monto_mensual, licencia_activa_desde')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // maybeSingle() devuelve error:null cuando no hay filas, así que un error aquí SIEMPRE es
    // infraestructura — no un "no existe". Se separa para no mentirle al admin (mismo patrón que
    // comercios/[id]/editar).
    console.error('[fm] falló la consulta de la cuenta a editar:', error);
    return (
      <main className="admin-main">
        <div className="admin-encabezado">
          <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>
            Cuenta
          </h1>
          <Link className="admin-fila-slug" href="/admin/cuentas">
            ← Volver
          </Link>
        </div>
        <p className="admin-error" role="alert">
          No se pudo cargar esta cuenta. Revisa la conexión y recarga la página.
        </p>
      </main>
    );
  }

  if (!cuenta) notFound();

  // Todos los comercios: los de ESTA cuenta se listan; los demás alimentan el selector de "vincular"
  // (se filtra en JS para incluir también los sin cuenta, que .neq() dejaría fuera).
  const { data: comercios, error: errorComercios } = await supabase
    .from('comercios')
    .select('id, nombre, slug, cuenta_id')
    .order('nombre');
  if (errorComercios) console.error('[fm] falló la consulta de comercios de la cuenta:', errorComercios);
  const todos = comercios ?? [];
  const negocios = todos.filter((c) => c.cuenta_id === id);
  const disponibles = todos.filter((c) => c.cuenta_id !== id).map((c) => ({ id: c.id, nombre: c.nombre }));
  // El cupo lo calcula la MISMA función que lo APLICA al vincular (cupoDeCuenta comparte el conteo
  // con verificarLimiteCuenta): contarlo a mano acá ya divergió una vez — sumaba las sucursales
  // principales, que desde la 0012 no consumen cupo, y esta pantalla escondía el formulario de
  // vincular en cuentas que el backend sí aceptaba (una Growth con 1 comercio + su Principal se
  // veía 2/2 estando 1/2). Si el conteo falla, se cae a los comercios visibles: subestima y deja
  // el formulario a la vista — la barrera real es el Server Action, no esta pantalla.
  const cupo = await cupoDeCuenta(supabase, id);
  const usados = cupo.ok ? cupo.usadas : negocios.length;
  const hayCupo = cuenta.limite_negocios === null || usados < cuenta.limite_negocios;

  // bind() fija el id como primer argumento; la firma que ve useActionState sigue siendo
  // (estado, formData).
  const accion = accionActualizarCuenta.bind(null, id);
  const eliminar = accionEliminarCuenta.bind(null, id);
  const vincular = accionVincularComercio.bind(null, id);
  const crearComercioDeCuenta = accionCrearComercioDeCuenta.bind(null, id);
  const registrarCobroDeCuenta = accionRegistrarCobro.bind(null, id);
  const pedirPagoDeCuenta = accionPedirPago.bind(null, id);
  const cambiarModoDeCuenta = accionCambiarModoCobranza.bind(null, id);
  const posponerPagoDeCuenta = accionPosponerPago.bind(null, id);
  const perdonarCicloDeCuenta = accionPerdonarCiclo.bind(null, id);
  // `null` ante error, no `[]`: en una pantalla de cobros, una lista vacía significa "no le hemos
  // cobrado nada" — decirlo por un fallo de consulta llevaría a cobrar dos veces o a no cobrar.
  const cobros = await listarCobros(supabase, id);
  // Hasta cuándo tiene pagado en la app. `null` (error de lectura) no dice nada: mejor sin línea que una falsa.
  const periodos = await listarPeriodosPagados(supabase, id);
  const lineaPeriodo =
    periodos === null
      ? null
      : describirPeriodo(
          estadoDelPeriodo(periodos, hoyEnZona(null)),
          periodos.reduce<string | null>((max, p) => (max === null || p.hasta > max ? p.hasta : max), null),
        );
  // Cobros pendientes: los únicos que "Anular un cobro pendiente" (pestaña Cobranza) puede tocar —
  // anularCobroPendiente ya solo anula si el estado sigue 'pendiente', pero filtrar acá evita
  // ofrecer el botón sobre un cobro que ya no se puede anular.
  const cobrosPendientes = (cobros ?? []).filter((c) => c.estado === 'pendiente');

  // La pestaña activa por defecto es 'cobranza' si la cuenta está vencida o bloqueada (es lo
  // urgente); si no, 'datos'. Hoy MIGRACION_0038_APLICADA es siempre false (ver el comentario del
  // flag, arriba), así que `esUrgente` nunca es cierto y el default siempre cae en 'datos'.
  const esUrgente = MIGRACION_0038_APLICADA;
  const tabPorDefecto: PestanaId = esUrgente ? 'cobranza' : 'datos';
  const tabActiva: PestanaId = IDS_PESTANA.includes(tabParam ?? '') ? (tabParam as PestanaId) : tabPorDefecto;

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>
          {cuenta.nombre}
        </h1>
        <Link className="admin-fila-slug" href="/admin/cuentas">
          ← Volver
        </Link>
      </div>

      {/* Navegación entre pestañas por querystring (?tab=…): compartible y el botón atrás del
          navegador funciona, porque esta es una Server Component que lee `searchParams` — nada de
          estado de cliente. Mismo componente visual que los filtros de /comercio/reportes
          (.filtro-chips/.filtro-chip), con aria-current además de la clase "activo" para quien usa
          lector de pantalla. */}
      <nav className="filtro-chips reveal d1" style={{ marginBottom: 20 }} aria-label="Secciones de la cuenta">
        {PESTANAS.map((p) => (
          <Link
            key={p.id}
            href={`?tab=${p.id}`}
            className={`filtro-chip${tabActiva === p.id ? ' activo' : ''}`}
            aria-current={tabActiva === p.id ? 'page' : undefined}
          >
            {p.etiqueta}
          </Link>
        ))}
      </nav>

      {tabActiva === 'datos' && (
        <div className="reveal d2">
          <FormularioCuenta
            accion={accion}
            inicial={{
              nombre: cuenta.nombre,
              limite_negocios: cuenta.limite_negocios,
              plan: cuenta.plan,
              licencia_estado: cuenta.licencia_estado,
              licencia_monto_mensual: cuenta.licencia_monto_mensual,
              licencia_activa_desde: cuenta.licencia_activa_desde,
            }}
            textoBoton="Guardar cambios"
          />

          {/* Solo se puede borrar una cuenta SIN negocios: con negocios, el FK (23503) lo impediría
              de todas formas, pero se oculta el botón para no ofrecer una acción que va a fallar. */}
          {negocios.length === 0 && <BotonEliminarCuenta accion={eliminar} nombre={cuenta.nombre} />}
        </div>
      )}

      {tabActiva === 'negocios' && (
        <section className="panel reveal d2" style={{ marginTop: 0 }}>
          <p className="titulo-seccion" style={{ marginBottom: 12 }}>
            Negocios de esta cuenta ({usados} de {cuenta.limite_negocios ?? '∞'})
          </p>
          {negocios.length === 0 ? (
            <p className="field-aviso">Esta cuenta no tiene negocios asignados todavía.</p>
          ) : (
            <div className="admin-lista">
              {negocios.map((c) => (
                <Link key={c.id} className="admin-fila" href={`/admin/comercios/${c.id}/editar`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span className="icono-circulo acento" aria-hidden="true">
                      <span className="icono">storefront</span>
                    </span>
                    <div>
                      <div className="admin-fila-nombre">{c.nombre}</div>
                      <div className="admin-fila-slug">/{c.slug}</div>
                    </div>
                  </div>
                  <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
                </Link>
              ))}
            </div>
          )}

          {hayCupo ? (
            <FormularioVincular accion={vincular} disponibles={disponibles} />
          ) : (
            <p className="field-aviso" style={{ marginTop: 14 }}>
              La cuenta alcanzó su límite de {cuenta.limite_negocios ?? '∞'} negocio(s). Subí el límite para
              vincular más.
            </p>
          )}

          {/* Alta de un comercio nuevo, de verdad nuevo (Vincular arriba solo reasigna uno YA
              CREADO). Plegado por defecto: es la acción menos frecuente de las dos y la más pesada
              visualmente (9 campos + vista previa de tarjeta) — no debe ser lo primero que se ve al
              abrir la pestaña. */}
          <details style={{ marginTop: 14 }}>
            <summary className="admin-fila-slug" style={{ cursor: 'pointer' }}>+ Crear un comercio nuevo</summary>
            <div style={{ marginTop: 14 }}>
              <FormularioComercio
                accion={crearComercioDeCuenta}
                textoBoton="Crear comercio"
                cuentas={[{ id, nombre: cuenta.nombre }]}
                hoyIso={hoyEnZona(null)}
              />
            </div>
          </details>
        </section>
      )}

      {tabActiva === 'cobros' && (
        <section className="panel reveal d2" style={{ marginTop: 0 }}>
          <h2 className="subtitle" style={{ marginTop: 0 }}>Cobros</h2>
          <p className="admin-fila-slug" style={{ marginTop: -6 }}>
            Registro de seguimiento. El dueño los ve en su panel con un comprobante que aclara que
            NO tiene validez fiscal.
          </p>

          {lineaPeriodo && <p className="admin-fila-slug" style={{ marginTop: -2 }}>{lineaPeriodo}</p>}

          {cobros === null ? (
            <p className="admin-error" role="alert">No se pudieron cargar los cobros. Recargá la página.</p>
          ) : cobros.length === 0 ? (
            <p className="admin-vacio">Todavía no hay cobros registrados en esta cuenta.</p>
          ) : (
            <div className="admin-lista">
              {cobros.map((c) => (
                <div key={c.id} className="admin-fila">
                  <div>
                    <div className="admin-fila-nombre dato-mono">${c.monto.toFixed(2)}</div>
                    <div className="admin-fila-slug">
                      #{c.numero} · {c.periodoDesde} — {c.periodoHasta}
                      {c.pagadoEn && ` · pagado ${c.pagadoEn}`}
                    </div>
                    {/* Lo que dice el cobro de la app: si es un ajuste por subir de plan, a qué plan, y cómo entró. */}
                    {(c.tipo === 'ajuste' || c.planDestino || c.metodo) && (
                      <div className="admin-fila-slug">
                        {c.tipo === 'ajuste' ? 'Ajuste por subir de plan' : 'Período completo'}
                        {c.planDestino && ` → ${etiquetaDePlan(c.planDestino)}`}
                        {c.metodo && ` · ${c.metodo}`}
                      </div>
                    )}
                    {/* Un cobro de la app que sigue pendiente: si el cliente pagó por fuera de Wompi (o el aviso
                        no llegó), FM lo marca pagado desde acá. */}
                    {c.estado === 'pendiente' && c.metodo === METODO_WOMPI && (
                      <MarcarPagado accion={accionMarcarCobroPagado.bind(null, id, c.id)} />
                    )}
                  </div>
                  <span className={`pastilla ${c.estado === 'pagado' ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
                    {c.estado === 'pagado' ? 'Pagado' : c.estado === 'anulado' ? 'Anulado' : 'Pendiente'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <FormularioCobro
            accion={registrarCobroDeCuenta}
            cobros={cobros ?? []}
            montoSugerido={cuenta.licencia_monto_mensual}
          />
        </section>
      )}

      {tabActiva === 'cobranza' && (
        <div className="reveal d2">
          {/* Estado derivado (spec cobranza, "Pantallas": "Al día hasta…", "Vencida hace N días",
              "Bloqueada", "Exenta", "Pospuesta hasta…"). Necesita estadoEfectivo(), que a su vez
              necesita las columnas de la migración 0038 — todavía sin aplicar (ver el comentario de
              MIGRACION_0038_APLICADA, arriba). Mismo criterio que la tarjeta "Cuentas vencidas o
              bloqueadas" del dashboard (Tarea 7): placeholder explícito, no se omite la sección. */}
          <section className="panel" style={{ marginTop: 0 }}>
            <p className="titulo-seccion" style={{ marginTop: 0, marginBottom: 4 }}>Estado</p>
            <div className="metric-valor" style={{ fontSize: '1.4rem' }}>—</div>
            <p className="admin-fila-slug" style={{ marginTop: 4 }}>
              Disponible cuando se aplique la migración 0038.
            </p>
          </section>

          {/* Lo que sí funciona hoy (Tarea 4a): pedirPago y accionAnularCobro no tocan ninguna
              columna nueva. `key` por la cantidad de pendientes, mismo criterio que
              FormularioCobro (`key={cobros.length}`): al crear un cobro con éxito, esa cantidad
              cambia, el formulario se remonta vacío y queda listo para pedir el siguiente. */}
          <FormularioPedirPago
            key={cobrosPendientes.length}
            accion={pedirPagoDeCuenta}
            montoSugerido={cuenta.licencia_monto_mensual}
          />

          <section className="panel" style={{ marginTop: 14 }}>
            <p className="titulo-seccion" style={{ marginTop: 0 }}>Anular un cobro pendiente</p>
            {cobrosPendientes.length === 0 ? (
              <p className="field-aviso">No hay cobros pendientes en esta cuenta.</p>
            ) : (
              <div className="admin-lista">
                {cobrosPendientes.map((c) => (
                  <div key={c.id} className="admin-fila">
                    <div>
                      <div className="admin-fila-nombre dato-mono">${c.monto.toFixed(2)}</div>
                      <div className="admin-fila-slug">
                        #{c.numero} · {c.periodoDesde} — {c.periodoHasta}
                        {c.metodo && ` · ${c.metodo}`}
                      </div>
                    </div>
                    <BotonAnularCobro accion={accionAnularCobro.bind(null, id, c.id)} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Lo que depende de la migración (Tarea 4b): ya cableado a sus Server Actions reales,
              pero deshabilitado — MIGRACION_0038_APLICADA es false hoy. */}
          <ControlesCobranzaFutura
            accionModo={cambiarModoDeCuenta}
            accionPosponer={posponerPagoDeCuenta}
            accionPerdonar={perdonarCicloDeCuenta}
            disponible={MIGRACION_0038_APLICADA}
          />
        </div>
      )}
    </main>
  );
}
