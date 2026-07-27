import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import MenuOpciones from './MenuOpciones';
import NavInferior from './NavInferior';
import SelectorContexto, { type ComercioConSucursales } from './SelectorContexto';

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo. Gate
  // COMPARTIDO (no owner-only): un cajero también entra al shell — su nav y su header son mínimos.
  const { nombre, rol, comercioId, sucursalId, sucursalActiva, membresias } = await verifyComercioAcceso();

  // Comercios owner + sus sucursales activas: alimentan el switcher. UNA consulta para todas las
  // sucursales (deny-all bajo RLS → service client). Si falla, el sheet degrada a solo-comercios
  // (listas vacías) — nunca tumba el shell.
  const comerciosOwner = membresias
    .filter((m) => m.rol === 'owner')
    .map((m) => ({ comercioId: m.comercioId, nombre: m.nombre }));

  let comerciosConSucursales: ComercioConSucursales[] = [];
  if (rol === 'owner' && comerciosOwner.length > 0) {
    const { data, error } = await createServiceClient()
      .from('sucursales')
      .select('id, comercio_id, nombre, es_principal')
      .in('comercio_id', comerciosOwner.map((c) => c.comercioId))
      .eq('activa', true)
      .order('es_principal', { ascending: false })
      .order('created_at');
    if (error) console.error('[comercio] no se pudieron cargar las sucursales del switcher:', error);
    comerciosConSucursales = comerciosOwner.map((c) => ({
      ...c,
      sucursales: (data ?? [])
        .filter((s) => s.comercio_id === c.comercioId)
        .map((s) => ({ id: s.id, nombre: s.nombre, esPrincipal: s.es_principal })),
    }));
  }

  // El cajero no tiene switcher: su contexto es fijo y se muestra en la marca del header.
  const marcaCajero = sucursalActiva ? `${nombre} · ${sucursalActiva.nombre}` : nombre;
  // Cajero con sucursal asignada pero SIN contexto operable (la apagaron, o falló la lectura):
  // el header no puede seguir diciendo "estás en Centro" cuando ahí no puede operar — sería una
  // señal falsa, y en el diseño nuevo esta etiqueta significa "dónde estoy parado". Se avisa
  // NEUTRO ("Sin sucursal activa"): sucursalActiva===null también cubre un error de BD, y el
  // diagnóstico preciso con su acción ya lo da /comercio/escanear.
  const cajeroSinContexto = rol === 'cajero' && sucursalId !== null && sucursalActiva === null;

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <Link href="/comercio/panel" className="admin-marca">
          <span className="icono-circulo" aria-hidden="true">
            <span className="icono icono-lleno" style={{ fontSize: 18 }}>storefront</span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            {rol === 'owner' ? nombre : marcaCajero}
            {cajeroSinContexto && (
              <span className="admin-fila-slug" style={{ fontWeight: 400 }}>Sin sucursal activa</span>
            )}
          </span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {rol === 'owner' && (
            <SelectorContexto
              comercios={comerciosConSucursales}
              comercioActivoId={comercioId}
              sucursalActiva={sucursalActiva}
            />
          )}
          {/* Menú de más opciones: secciones fuera de la barra de 5 + tema + cerrar sesión. Ocupa
              el lugar que tenía el botón "Salir" en vez de sumarse a él — el header a 360px no
              tenía 56px libres que darle (la cuenta está en MenuOpciones.tsx y en el comentario de
              .contexto-pastilla). */}
          <MenuOpciones rol={rol} />
        </div>
      </header>
      {children}
      <NavInferior rol={rol} />
    </div>
  );
}
