import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { cerrarSesionComercio } from '../actions';
import NavInferior from './NavInferior';
import SelectorComercio from './SelectorComercio';

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo. Gate
  // COMPARTIDO (no owner-only): un cajero también entra al shell — su nav y su header son mínimos.
  const { nombre, rol, comercioId, sucursalId, membresias } = await verifyComercioAcceso();

  // Lista de comercios donde la cuenta es owner: alimenta el selector multi-comercio del header.
  const comerciosOwner = membresias
    .filter((m) => m.rol === 'owner')
    .map((m) => ({ comercioId: m.comercioId, nombre: m.nombre }));

  // Nombre de la sucursal del cajero (si su membresía está atada a una). Best-effort y solo para
  // cajeros: sucursales es deny-all bajo RLS → service client. Si falla, se muestra solo el comercio.
  let nombreSucursal: string | null = null;
  if (rol === 'cajero' && sucursalId) {
    const { data } = await createServiceClient()
      .from('sucursales')
      .select('nombre')
      .eq('id', sucursalId)
      .maybeSingle();
    nombreSucursal = data?.nombre ?? null;
  }

  // El cajero no tiene panel: su "inicio" es el escáner.
  const inicio = rol === 'owner' ? '/comercio/panel' : '/comercio/escanear';

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link href={inicio} className="admin-marca">
          <span className="icono-circulo" aria-hidden="true">
            <span className="icono icono-lleno" style={{ fontSize: 18 }}>storefront</span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            {nombre}
            {nombreSucursal && (
              <span className="admin-fila-slug" style={{ fontWeight: 400 }}>{nombreSucursal}</span>
            )}
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {rol === 'owner' && comerciosOwner.length >= 2 && (
            <SelectorComercio comercios={comerciosOwner} activo={comercioId} />
          )}
          <form action={cerrarSesionComercio}>
            <button className="admin-salir" type="submit">Salir</button>
          </form>
        </div>
      </header>
      {children}
      <NavInferior rol={rol} />
    </div>
  );
}
