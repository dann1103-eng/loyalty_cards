import type { Metadata } from 'next';
import Link from 'next/link';
import { verifyComercioAccesoSinBloqueo } from '@/lib/comercio/verifyComercioAcceso';
import { listarProgramas } from '@/lib/comercio/programas';
import { createServiceClient } from '@/lib/supabase/server';
import type { EstadoCobranza } from '@/lib/comercios/cobranza';
import { formatearFecha } from '@/lib/tarjetas/vigencia';
import { URL_MANIFIESTO_COMERCIO } from '@/lib/manifiestos';
import MenuOpciones from './MenuOpciones';
import NavInferior from './NavInferior';
import SelectorContexto, { type ComercioConSucursales } from './SelectorContexto';

// Cubre TODO el panel del dueño y del cajero (herencia de metadata: el segmento más profundo
// gana, pero acá no hace falta pisarlo). Sin esto, un dueño que en Android toca "Agregar a
// pantalla de inicio" desde su panel instala el manifest de la raíz —el portal del CLIENTE
// (app/manifest.ts)— y el atajo le abre /mi-tarjeta en vez de su propio panel (onboarding real,
// 2026-09-22). Ver lib/manifiestos.ts.
export const metadata: Metadata = { manifest: URL_MANIFIESTO_COMERCIO };

// Banner de cobranza para el dueño (spec 2026-09-21-cobranza-design.md, "Pantallas → Dueño"). Solo
// los estados que necesitan avisarle algo devuelven banner: `al_dia` no tiene nada que decir, y
// `bloqueada` NUNCA llega acá — verifyComercioAcceso() (el gate que SÍ bloquea, usado por cada
// página del panel) ya redirigió al dueño a /comercio/plan?suspendida=1 antes de que el layout
// vuelva a renderizar con esa cuenta, así que la pantalla de esa página es su "banner". La única
// excepción es justo /comercio/plan (usa verifyComercioOwnerSinBloqueo) — y ahí el párrafo de
// `?suspendida=1` ya cubre el aviso, uno del layout arriba sería redundante.
//
// `.alerta` (role="alert", ya usado en el panel para "llegaste al tope de tu plan") para lo que
// necesita ACCIÓN pronto; `.nota` (informativo, sin urgencia) para lo que no.
function bannerCobranza(estado: EstadoCobranza | null): { clase: 'alerta' | 'nota'; texto: string } | null {
  if (!estado) return null;
  const dias = (n: number) => `${n} día${n === 1 ? '' : 's'}`;

  switch (estado.tipo) {
    case 'vencida':
      return {
        clase: 'alerta',
        texto: estado.esPrimerPago
          ? `Tu período de prueba termina en ${dias(estado.diasParaBloqueo)}.`
          : `Tu pago venció hace ${dias(estado.diasVencida)}. Te quedan ${dias(estado.diasParaBloqueo)} antes de que se suspenda tu cuenta.`,
      };
    case 'pospuesta':
      return { clase: 'nota', texto: `Tu pago está pospuesto hasta el ${formatearFecha(estado.hasta)}.` };
    case 'exenta':
      return { clase: 'nota', texto: 'Tu cuenta tiene el servicio sin costo.' };
    default:
      return null;
  }
}

export default async function LayoutComercio({ children }: { children: React.ReactNode }) {
  // Primera barrera. NO la única: cada página y cada Server Action repiten el chequeo (con
  // verifyComercioAcceso(), que SÍ bloquea) — el layout usa la variante SIN bloqueo a propósito:
  // un redirect() desde acá sacaría también a /comercio/plan, la página a la que ese bloqueo manda
  // al dueño (spec cobranza, "Cómo se bloquea"). Gate COMPARTIDO (no owner-only): un cajero también
  // entra al shell — su nav y su header son mínimos.
  const { nombre, rol, comercioId, sucursalId, sucursalActiva, membresias, estadoCobranza } =
    await verifyComercioAccesoSinBloqueo();

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

  // El tipo del programa PRINCIPAL decide el reparto de la nav: con contador 'ninguno' (cupón,
  // membresía, descuento) ninguna recompensa se puede canjear nunca, así que Premios le cede su
  // lugar en la barra a Programas (ver lib/comercio/navegacion.ts).
  //
  // Arranca en 'puntos' —el reparto de HOY— y ese valor es también el fallback ante un error de la
  // consulta: listarProgramas devuelve null (ya lo loguea) y `?? 'puntos'` deja la barra completa y
  // con Escanear centrado. Hasta ahora la nav no podía fallar; con esta consulta sí puede, y una
  // barra vacía o descentrada sería mucho peor que un destino de más.
  //
  // Solo para el OWNER: el cajero no ve ninguno de los dos destinos que se intercambian
  // (RUTAS_CAJERO), así que su nav sale idéntica con cualquier tipo —hay una prueba que lo fija— y
  // esto le ahorra una consulta en CADA pantalla del panel, incluida la que más abre en el día.
  let tipoTarjetaPrincipal = 'puntos';
  if (rol === 'owner') {
    const programas = await listarProgramas(createServiceClient(), comercioId);
    tipoTarjetaPrincipal = (programas ?? []).find((p) => p.esPrincipal)?.tipoTarjeta ?? 'puntos';
  }

  // El cajero no tiene switcher: su contexto es fijo y se muestra en la marca del header.
  const marcaCajero = sucursalActiva ? `${nombre} · ${sucursalActiva.nombre}` : nombre;
  // Cajero con sucursal asignada pero SIN contexto operable (la apagaron, o falló la lectura):
  // el header no puede seguir diciendo "estás en Centro" cuando ahí no puede operar — sería una
  // señal falsa, y en el diseño nuevo esta etiqueta significa "dónde estoy parado". Se avisa
  // NEUTRO ("Sin sucursal activa"): sucursalActiva===null también cubre un error de BD, y el
  // diagnóstico preciso con su acción ya lo da /comercio/escanear.
  const cajeroSinContexto = rol === 'cajero' && sucursalId !== null && sucursalActiva === null;

  // Solo el OWNER: un cajero no tiene botón de pago, y si la cuenta llega a `bloqueada` el cajero
  // ya fue redirigido a /comercio/suspendida por el gate de sus propias páginas (que SÍ bloquea) —
  // nunca llega a ver este layout con esa cuenta bloqueada.
  const banner = rol === 'owner' ? bannerCobranza(estadoCobranza) : null;

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
          <MenuOpciones rol={rol} tipoTarjeta={tipoTarjetaPrincipal} />
        </div>
      </header>
      {banner && (
        <p className={banner.clase} role={banner.clase === 'alerta' ? 'alert' : 'status'} style={{ margin: '14px 20px 0' }}>
          {banner.texto}
          {banner.clase === 'alerta' && (
            <>
              {' '}
              <Link href="/comercio/plan" style={{ fontWeight: 700 }}>Pagar</Link>
            </>
          )}
        </p>
      )}
      {children}
      <NavInferior rol={rol} tipoTarjeta={tipoTarjetaPrincipal} />
    </div>
  );
}
