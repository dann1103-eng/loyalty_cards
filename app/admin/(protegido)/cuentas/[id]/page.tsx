import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { cupoDeCuenta } from '@/lib/comercios/cuentas';
import FormularioCuenta from '../FormularioCuenta';
import FormularioVincular from '../FormularioVincular';
import BotonEliminarCuenta from '../BotonEliminarCuenta';
import { accionActualizarCuenta, accionEliminarCuenta, accionVincularComercio } from '../actions';

export const dynamic = 'force-dynamic';

export default async function PaginaEditarCuenta({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifyFmAdmin();
  const { id } = await params;

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

      <section className="panel reveal d2" style={{ marginTop: 18 }}>
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
      </section>

      {/* Solo se puede borrar una cuenta SIN negocios: con negocios, el FK (23503) lo impediría de
          todas formas, pero se oculta el botón para no ofrecer una acción que va a fallar. */}
      {negocios.length === 0 && <BotonEliminarCuenta accion={eliminar} nombre={cuenta.nombre} />}
    </main>
  );
}
