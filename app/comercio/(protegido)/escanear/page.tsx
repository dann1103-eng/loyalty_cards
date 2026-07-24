import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSucursales } from '@/lib/comercio/sucursales';
import Escaner from './Escaner';

export const dynamic = 'force-dynamic';

// Pantalla C7 (Fase 4/9): el cajero o el dueño escanea el QR del pass del cliente (o el impreso del
// panel) y suma sellos/puntos o canjea recompensas. También acepta ?token= para llegar sin cámara
// desde el directorio de clientes.
//
// Gate COMPARTIDO (Fase 7), no owner-only: el escáner es la pantalla del CAJERO. Con
// verifyComercioOwner() un cajero era rebotado → loop de redirect. verifyComercioAcceso() admite
// owner Y cajero. Fase 9 usa el retorno del gate para la atribución por sucursal:
//   - CAJERO → sucursal FIJA (la de su membresía). Si el dueño la desactivó, no puede acreditar.
//   - OWNER  → picker entre las sucursales ACTIVAS (puede dejarlo en "Sin especificar").
// La atribución real la decide el servidor (resolverSucursalDeAccion en actions.ts): para el cajero
// el valor que mande el cliente se ignora. Acá solo se arma la UI.
export default async function PaginaEscanear({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sesion = await verifyComercioAcceso();
  const { token } = await searchParams;

  const supabase = createServiceClient();
  const sucursales = await listarSucursales(supabase, sesion.comercioId);
  // null = error de BD (distinto de [] = no hay sucursales). Para el cajero se distingue del caso
  // "desactivada": un fallo transitorio no es lo mismo que una baja real, aunque ambos bloqueen.
  const errorCargaSucursales = sucursales === null;
  const activas = (sucursales ?? []).filter((s) => s.activa);

  // Cajero: su sucursal la fija la membresía; debe seguir ACTIVA para poder operar.
  const suya =
    sesion.rol === 'cajero' ? activas.find((s) => s.id === sesion.sucursalId) : undefined;
  const cajeroSinSucursalActiva = sesion.rol === 'cajero' && !errorCargaSucursales && !suya;

  return (
    <main className="admin-main" style={{ maxWidth: 560 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Escanear tarjeta</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      {errorCargaSucursales && sesion.rol === 'cajero' ? (
        // Fallo transitorio al leer las sucursales: no confundir con una baja real. Fail-closed igual
        // (el cajero no puede operar sin su sucursal), pero el mensaje es "reintentá", no "desactivada".
        <p className="alerta reveal d2" role="alert" style={{ marginTop: 0 }}>
          No se pudieron cargar las sucursales. Recargá la página e intentá de nuevo.
        </p>
      ) : cajeroSinSucursalActiva ? (
        // Su sucursal fue desactivada (o su membresía no apunta a ninguna activa): sin acreditar. El
        // RPC igual la rechazaría (sucursal_invalida), pero acá se lo decimos claro antes de escanear.
        <p className="alerta reveal d2" role="alert" style={{ marginTop: 0 }}>
          Tu sucursal está desactivada. Contactá al dueño para que la reactive o te reasigne a otra.
        </p>
      ) : sesion.rol === 'cajero' ? (
        <Escaner tokenInicial={token} sucursalFija={{ id: suya!.id, nombre: suya!.nombre }} />
      ) : (
        <Escaner tokenInicial={token} sucursales={activas.map((s) => ({ id: s.id, nombre: s.nombre }))} />
      )}
    </main>
  );
}
