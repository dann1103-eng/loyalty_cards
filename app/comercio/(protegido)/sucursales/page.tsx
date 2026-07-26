import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSucursales } from '@/lib/comercio/sucursales';
import { cupoDeCuenta } from '@/lib/comercios/cuentas';
import FormularioSucursal from './FormularioSucursal';
import ModalAgregarLocal from './ModalAgregarLocal';
import BotonEstadoSucursal from './BotonEstadoSucursal';
import AvisoComercioActivo from '../AvisoComercioActivo';

export const dynamic = 'force-dynamic';

// `?agregar=1` abre el modal al cargar: es el destino del enlace "Agregar local…" del switcher
// (SelectorContexto), que no puede abrir un modal que vive en OTRA página.
export default async function PaginaSucursales({
  searchParams,
}: {
  searchParams: Promise<{ agregar?: string }>;
}) {
  const { comercioId, nombre } = await verifyComercioOwner();
  const { agregar } = await searchParams;
  const supabase = createServiceClient();

  // listarSucursales trae activas e inactivas: el dueño necesita ver las apagadas para reactivarlas.
  const sucursales = await listarSucursales(supabase, comercioId);

  // Cupo del plan: si la cuenta está llena, el alta se reemplaza por el aviso (crear igual
  // rechazaría — esto lo dice ANTES y sin formulario inútil). Comercio sin cuenta (legado): sin
  // tope conocido, se muestra el formulario (paridad con crearSucursal, que tampoco bloquea ahí).
  const { data: comercio } = await supabase
    .from('comercios').select('cuenta_id').eq('id', comercioId).maybeSingle();
  let avisoCupo: string | null = null;
  if (comercio?.cuenta_id) {
    const cupo = await cupoDeCuenta(supabase, comercio.cuenta_id);
    if (cupo.ok && cupo.limite !== null && cupo.usadas >= cupo.limite) {
      avisoCupo = `Alcanzaste el límite de tu plan (${cupo.limite} ${cupo.limite === 1 ? 'local' : 'locales'}). Hablá con FM para ampliarlo.`;
    }
  }

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Sucursales</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <AvisoComercioActivo />

      <div className="reveal d2">
        {avisoCupo ? (
          <p className="admin-vacio">{avisoCupo}</p>
        ) : (
          <ModalAgregarLocal
            nombreComercio={nombre}
            puedeCrearComercio={Boolean(comercio?.cuenta_id)}
            abrirAlCargar={agregar === '1'}
          />
        )}
      </div>

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {sucursales === null ? (
          <p className="admin-error" role="alert">No se pudieron cargar las sucursales. Recargá la página.</p>
        ) : sucursales.length === 0 ? (
          <p className="admin-vacio">Todavía no hay sucursales. Agregá la primera.</p>
        ) : (
          sucursales.map((s) => (
            <div
              key={s.id}
              className="admin-fila"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">{s.esPrincipal ? 'home_pin' : 'store'}</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{s.nombre}</div>
                    {s.esPrincipal && <div className="admin-fila-slug">Sucursal principal</div>}
                  </div>
                </div>
                <span className={`pastilla ${s.activa ? 'pastilla-activo' : 'pastilla-inactivo'}`}>
                  {s.activa ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 220px' }}>
                  <FormularioSucursal sucursal={{ id: s.id, nombre: s.nombre }} />
                </div>
                {/* La principal no se puede desactivar (candado en la capa lib): sin botón acá. */}
                {!s.esPrincipal && <BotonEstadoSucursal id={s.id} nombre={s.nombre} activa={s.activa} />}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
