import Link from 'next/link';
import { verifyFmAdmin } from '@/lib/fm/verifyFmAdmin';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PaginaCuentas() {
  // Defensa en profundidad: el layout ya verificó, pero los layouts no se re-ejecutan en
  // navegación del lado del cliente. cache() hace que esto no cueste una consulta extra.
  await verifyFmAdmin();

  const supabase = createServiceClient();
  const { data: cuentas, error } = await supabase
    .from('cuentas_comercio')
    .select('id, nombre, limite_negocios')
    .order('nombre');

  if (error) {
    // Igual que comercios/page: un fallo de consulta NO puede verse como "vacío". "Sin cuentas" y
    // "la BD no responde" tienen que verse distinto.
    console.error('[fm] falló la consulta de cuentas:', error);
  }

  // Conteo de negocios por cuenta (una sola consulta liviana; se agrupa acá, como comercios/page).
  const { data: comercios, error: errorComercios } = await supabase.from('comercios').select('id, cuenta_id');
  if (errorComercios) console.error('[fm] falló el conteo de negocios por cuenta:', errorComercios);
  const cuentaPorComercio = new Map<string, string>();
  const negociosPorCuenta = new Map<string, number>();
  for (const c of comercios ?? []) {
    if (!c.cuenta_id) continue;
    cuentaPorComercio.set(c.id, c.cuenta_id);
    negociosPorCuenta.set(c.cuenta_id, (negociosPorCuenta.get(c.cuenta_id) ?? 0) + 1);
  }
  // El límite cuenta sucursales también (ver verificarLimiteCuenta) — sucursales no tiene
  // cuenta_id directo, se suma vía el mapa de comercio→cuenta de arriba. Las PRINCIPALES quedan
  // fuera (migración 0012): no consumen cupo, así que contarlas acá mostraría "2 de 1" en una
  // cuenta que en realidad está 1/1, y marcaría como llenas cuentas que no lo están.
  const { data: sucursales, error: errorSucursales } = await supabase
    .from('sucursales')
    .select('comercio_id')
    .eq('es_principal', false);
  if (errorSucursales) console.error('[fm] falló el conteo de sucursales por cuenta:', errorSucursales);
  for (const s of sucursales ?? []) {
    const cuentaId = cuentaPorComercio.get(s.comercio_id);
    if (cuentaId) negociosPorCuenta.set(cuentaId, (negociosPorCuenta.get(cuentaId) ?? 0) + 1);
  }

  return (
    <main className="admin-main">
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Cuentas</h1>
        <Link className="btn-primary" style={{ width: 'auto', marginTop: 0 }} href="/admin/cuentas/nuevo">
          <span className="icono" style={{ fontSize: 20 }} aria-hidden="true">add</span>
          Nueva cuenta
        </Link>
      </div>

      {error ? (
        <p className="admin-error" role="alert">
          No se pudo cargar la lista de cuentas. Revisa la conexión y recarga la página.
        </p>
      ) : !cuentas || cuentas.length === 0 ? (
        <p className="admin-vacio">Todavía no hay cuentas. Crea la primera.</p>
      ) : (
        <div className="admin-lista reveal d2">
          {cuentas.map((c) => {
            const usados = negociosPorCuenta.get(c.id) ?? 0;
            const llena = c.limite_negocios !== null && usados >= c.limite_negocios;
            return (
              <Link key={c.id} className="admin-fila" href={`/admin/cuentas/${c.id}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">account_balance</span>
                  </span>
                  <div>
                    <div className="admin-fila-nombre">{c.nombre}</div>
                    <div className="admin-fila-slug">
                      <span className="dato-mono">{usados}</span> de{' '}
                      <span className="dato-mono">{c.limite_negocios ?? '∞'}</span> negocio(s)/sucursal(es)
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {/* Insignia de cobranza (spec 2026-09-21-rework-admin-comercio-design.md, "Lista
                      de cuentas"): va PRIMERO (a la izquierda de la de cupo) porque es la que FM
                      necesita ver primero para decidir si entrar a esa cuenta es urgente. Hoy es un
                      placeholder neutro sin calcular nada: el estado real (Al día/Vencida/
                      Bloqueada/Exenta/Pospuesta) sale de estadoEfectivo(), que necesita las
                      columnas de la migración 0038 (cuentas_comercio.cobranza / cobranza_desde /
                      cobranza_pospuesta_hasta) — todavía no aplicada contra la base real. Agregar
                      esas columnas al .select() de esta página antes de tiempo rompería la
                      consulta completa de la lista, no solo esta pastilla. Cuando la Tarea 11
                      aplique la migración, esto se reemplaza por la pastilla real (colores en
                      .pastilla-activo/.pastilla-inactivo/.pastilla-advertencia/.pastilla-neutral,
                      ya definidos en app/globals.css). */}
                  <span className="pastilla pastilla-neutral" title="Disponible cuando se aplique la migración 0038">
                    —
                  </span>
                  <span className={`pastilla ${llena ? 'pastilla-inactivo' : 'pastilla-activo'}`}>
                    {llena ? 'Llena' : 'Con cupo'}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
