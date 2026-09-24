import Link from 'next/link';
import QRCode from 'qrcode';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { urlRegistroPrograma } from '@/lib/comercio/urlRegistroPrograma';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';
import { reporteSucursales } from '@/lib/reportes/reportes';
import { listarProgramas } from '@/lib/comercio/programas';
import { primerosPasos } from '@/lib/comercio/primerosPasos';
import { textoAtajoEscanear, textoAtajoReglas } from '@/lib/tarjetas/textosPorTipo';
import { COLUMNAS_RESUMEN, resumenPrograma } from '@/lib/tarjetas/resumenPrograma';
import { listarNiveles } from '@/lib/tarjetas/descuento';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import PrimerosPasos from './PrimerosPasos';

export const dynamic = 'force-dynamic';

// Los atajos dependen del TIPO del programa principal: los tres primeros subtítulos describían una
// mecánica de sellos o de puntos a los ocho tipos ("Sumá sellos/puntos o canjeá premios" a un
// comercio de membresía, que al escanear lo único que hace es renovar). Los que sí valen para todos
// —programas, notificaciones, sucursales— siguen siendo texto fijo, y eso no es inconsistencia:
// solo cambia lo que de verdad cambia con la tarjeta.
function atajosPara(tipoTarjeta: string) {
  return [
    { href: '/comercio/escanear', icono: 'qr_code_scanner', tono: 'acento', titulo: 'Escanear tarjeta', sub: textoAtajoEscanear(tipoTarjeta) },
    // Sin tabla por tipo a propósito: esta pantalla ya esconde la sección de sellos cuando el tipo
    // no los usa, así que basta con no prometerlos. La frase vale para los ocho.
    { href: '/comercio/branding', icono: 'palette', tono: 'acento', titulo: 'Identidad visual', sub: 'Colores, imágenes y cómo se ve tu tarjeta' },
    { href: '/comercio/reglas', icono: 'rule', tono: 'menta', titulo: 'Reglas del programa', sub: textoAtajoReglas(tipoTarjeta) },
    { href: '/comercio/programas', icono: 'style', tono: 'acento', titulo: 'Programas de tarjeta', sub: 'Tipo, configuración y QR de cada uno' },
    { href: '/comercio/notificaciones', icono: 'campaign', tono: 'menta', titulo: 'Notificaciones', sub: 'Campañas manuales y aviso de inactividad' },
    { href: '/comercio/recompensas', icono: 'redeem', tono: 'acento', titulo: 'Recompensas activas', sub: 'Catálogo de premios canjeables' },
    { href: '/comercio/sucursales', icono: 'store', tono: 'menta', titulo: 'Sucursales', sub: 'Locales que comparten tu tarjeta' },
    { href: '/comercio/cajeros', icono: 'badge', tono: 'acento', titulo: 'Cajeros', sub: 'Cuentas del personal por sucursal' },
    { href: '/comercio/clientes', icono: 'group', tono: 'neutro', titulo: 'Directorio de clientes', sub: 'Quiénes tienen tu tarjeta' },
    { href: '/comercio/reportes', icono: 'insights', tono: 'menta', titulo: 'Reportes', sub: 'Visitas, premios y clientes por período, en Excel' },
  ];
}

// El cajero solo ve los atajos de SUS secciones (las demás lo rebotarían en su gate de página).
const RUTAS_ATAJOS_CAJERO = ['/comercio/escanear', '/comercio/clientes'];

export default async function PaginaPanel() {
  // Defensa en profundidad: el layout ya verificó, pero no se re-ejecuta en navegación del
  // cliente. cache() hace que no cueste una consulta extra.
  //
  // Gate COMPARTIDO (plan 2026-07-25 §4.8): el cajero también ve el Resumen — métricas y QR de
  // registro le sirven en caja. No hay Server Actions en esta página; las secciones owner-only
  // siguen detrás de verifyComercioOwner en sus propias páginas.
  const { comercioId, rol, sucursalActiva } = await verifyComercioAcceso();
  const esOwner = rol === 'owner';

  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    // zona_horaria: el "hoy" con el que se cuentan las membresías y los cupones vigentes es el del
    // COMERCIO, no el del servidor. En UTC, a las 6 de la tarde en El Salvador ya es el día
    // siguiente, y una membresía que vence hoy aparecería vencida media tarde antes de tiempo.
    .select('nombre, slug, tipo_tarjeta, zona_horaria')
    .eq('id', comercioId)
    .maybeSingle();

  // El tipo y la meta que se anuncian acá salen del programa PRINCIPAL, no de las columnas legadas
  // del comercio (0024): son las que de verdad rigen las tarjetas que el dueño tiene entregadas.
  const programas = await listarProgramas(supabase, comercioId);
  const principal = (programas ?? []).find((p) => p.esPrincipal) ?? null;
  const tipoValor = principal?.tipoTarjeta ?? comercio?.tipo_tarjeta;

  // Los atajos se arman DESPUÉS del tipo: sus subtítulos salen de él.
  const todosLosAtajos = atajosPara(tipoValor ?? 'puntos');
  const atajos = esOwner
    ? todosLosAtajos
    : todosLosAtajos.filter((a) => RUTAS_ATAJOS_CAJERO.includes(a.href));

  // El tutorial. Solo para el DUEÑO: el cajero no puede tocar marca, reglas ni recompensas, así que
  // una lista de pasos que no puede completar sería una lista de reproches.
  //
  // Va con el TIPO del programa principal: los cuatro pasos cambian según la tarjeta. Sin esto, el
  // dueño de una membresía quedaba clavado en "1 de 4" para siempre, porque el paso 2 lo mandaba a
  // Reglas — una pantalla que a su tipo le esconde el formulario.
  const pasos = esOwner ? await primerosPasos(supabase, comercioId, tipoValor ?? 'puntos') : null;

  // Métricas reales. La consulta trae COLUMNAS_RESUMEN —o sea el estado completo de cada tarjeta MÁS
  // su programa_id— y no `puntos_actuales` a secas: sin el programa no hay por dónde agrupar, y sin
  // la vigencia y el acumulado no se pueden responder las preguntas de membresía, cupón y descuento.
  const { data: tarjetas, count } = await supabase
    .from('tarjetas')
    .select(COLUMNAS_RESUMEN, { count: 'exact' })
    .eq('comercio_id', comercioId);

  const totalClientes = count ?? 0;

  // Los niveles son del COMERCIO (no del programa) y solo los mira la familia 'descuento': se leen
  // una sola vez, y únicamente si hay algún programa de ese tipo.
  const programasActivos = programas ?? [];
  const niveles = programasActivos.some((p) => p.tipoTarjeta === 'descuento')
    ? ((await listarNiveles(supabase, comercioId)) ?? [])
    : [];

  // Una carta por programa activo, cada una con la pregunta de SU tipo. `null` = el comercio todavía
  // no tiene ninguna tarjeta: ahí manda el tutorial de arriba, no una métrica en cero.
  const cartasResumen = resumenPrograma(
    programasActivos,
    tarjetas ?? [],
    niveles,
    hoyEnZona(comercio?.zona_horaria ?? null),
  );

  // Contexto de sucursal (owner): actividad de ESA sucursal, con los reportes por sucursal ya
  // existentes. Sin contexto no se consulta nada extra. Una sucursal sin actividad todavía no
  // aparece en el reporte → carta en cero (no "sin carta": el contexto elegido siempre se ve).
  let actividadSucursal: { operaciones: number; canjes: number; clientes_unicos: number } | null = null;
  if (esOwner && sucursalActiva) {
    const filas = await reporteSucursales(supabase, comercioId);
    const fila = filas.find((f) => f.sucursal_id === sucursalActiva.id);
    actividadSucursal = {
      operaciones: fila?.operaciones ?? 0,
      canjes: fila?.canjes ?? 0,
      clientes_unicos: fila?.clientes_unicos ?? 0,
    };
  }

  const tipo = TIPOS_TARJETA.find((t) => t.valor === tipoValor);
  const esSellos = tipoValor === 'sellos';

  // QR de registro: los clientes lo escanean en el local y crean su tarjeta.
  const urlRegistro = comercio?.slug
    ? urlRegistroPrograma(process.env.NEXT_PUBLIC_BASE_URL, comercio.slug, 'principal', true)
    : null;
  const qrRegistro = urlRegistro
    ? await QRCode.toDataURL(urlRegistro, { width: 380, margin: 1, color: { dark: '#0e0e0e', light: '#ffffff' } })
    : null;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <section className="reveal d1" style={{ marginBottom: 22 }}>
        <h1 className="title" style={{ fontSize: '1.7rem', margin: 0 }}>Resumen del local</h1>
        <p className="lede" style={{ marginTop: 6 }}>
          Así va tu programa de lealtad hoy.
        </p>
      </section>

      {/* El tutorial va ANTES que las métricas y solo mientras falte algún paso: un negocio recién
          dado de alta tiene todo en cero, y dos tarjetas grandes diciendo "0 clientes" no le dicen
          qué hacer. Se esconde solo cuando los cuatro están hechos. */}
      {pasos && <PrimerosPasos pasos={pasos} />}

      {/* Métricas apiladas (C2): tarjetas neutras, con el color del acento o del menta solo en el
          número y la etiqueta. */}
      <section className="metric-pila reveal d2">
        <div className="metric-carta naranja">
          <div className="metric-etiqueta">
            <span>Clientes con tarjeta</span>
            <span className="icono" aria-hidden="true">groups</span>
          </div>
          <div>
            <div className="metric-valor">{totalClientes}</div>
            <div className="metric-sub">registrados en tu comercio</div>
          </div>
        </div>
        {/* Una carta por programa activo, cada una con la pregunta de SU tipo (resumenPrograma).
            Antes había UNA sola con la suma global de `puntos_actuales`: le decía "PUNTOS VIGENTES 0"
            a una membresía y "125000 puntos" a una gift card con $1 250.00 circulantes. */}
        {(cartasResumen ?? []).map((carta) => (
          <div key={carta.programaId} className="metric-carta menta">
            <div className="metric-etiqueta">
              <span>{carta.etiqueta}</span>
              <span className="icono" aria-hidden="true">auto_awesome</span>
            </div>
            <div>
              {/* El nombre solo aparece con más de un programa: con uno solo sería ruido. */}
              {carta.nombre && <div className="metric-sub" style={{ marginBottom: 6 }}>{carta.nombre}</div>}
              {/* El número grande y su palabra en chico, en la misma línea: "8 con descuento" entero
                  a 2.9rem se sale de la carta. La palabra va vacía en gift card y cashback, donde el
                  valor ya es dinero. */}
              <div className="metric-valor">
                {carta.valor}
                {carta.unidad && (
                  <span style={{ fontSize: '0.95rem', letterSpacing: '0.06em', marginLeft: 8 }}>{carta.unidad}</span>
                )}
              </div>
              <div className="metric-sub">{carta.detalle}</div>
            </div>
          </div>
        ))}
      </section>

      {sucursalActiva && actividadSucursal && (
        <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="admin-fila-nombre" style={{ fontSize: '1.05rem' }}>
              Actividad en {sucursalActiva.nombre}
            </h2>
            <span className="admin-fila-slug">contexto activo</span>
          </div>
          <div style={{ display: 'flex', gap: 28 }}>
            {[
              [actividadSucursal.clientes_unicos, 'Clientes'],
              [actividadSucursal.operaciones, 'Visitas'],
              [actividadSucursal.canjes, 'Premios'],
            ].map(([valor, etiqueta]) => (
              <div key={etiqueta}>
                <div className="dato-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--texto)', lineHeight: 1 }}>
                  {valor}
                </div>
                <div className="admin-fila-slug" style={{ marginTop: 4 }}>{etiqueta}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tu programa */}
      <section className="panel reveal d3" style={{ marginTop: 0, marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 className="admin-fila-nombre" style={{ fontSize: '1.15rem' }}>Tu programa</h2>
          <span className="pastilla pastilla-activo">Activo</span>
        </div>
        <p className="titulo-seccion" style={{ marginBottom: 4 }}>Tipo de tarjeta</p>
        <p style={{ fontWeight: 600 }}>{tipo?.etiqueta ?? tipoValor}</p>
        {tipo && (
          <p style={{ color: 'var(--texto-2)', fontSize: '0.9rem', marginTop: 4 }}>
            {tipo.descripcion}
            {esSellos && principal?.selloMeta ? ` Meta actual: ${principal.selloMeta} sellos.` : ''}
          </p>
        )}
      </section>

      {/* QR de registro para el local */}
      {qrRegistro && (
        <section className="panel reveal d4" style={{ marginTop: 0, marginBottom: 22, textAlign: 'center' }}>
          <h2 className="admin-fila-nombre" style={{ fontSize: '1.1rem' }}>Mostralo en tu local</h2>
          <p style={{ color: 'var(--texto-2)', fontSize: '0.85rem', margin: '4px 0 16px' }}>
            Tus clientes lo escanean y crean su tarjeta al instante.
          </p>
          <div className="qr-tile" style={{ maxWidth: 230, margin: '0 auto' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
            <img src={qrRegistro} alt={`Código QR de registro de ${comercio?.nombre}`} />
          </div>
          <p className="qr-codigo">/registro/{comercio?.slug}</p>
          <a
            className="btn-borde"
            style={{ marginTop: 12 }}
            href={qrRegistro}
            download={`qr-registro-${comercio?.slug}.png`}
          >
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">download</span>
            Descargar
          </a>
        </section>
      )}

      {/* Accesos rápidos */}
      <section className="reveal d5">
        <p className="titulo-seccion" style={{ marginBottom: 10 }}>Gestión rápida</p>
        <div className="panel-atajos" style={{ marginTop: 0 }}>
          {atajos.map((a) => (
            <Link key={a.href} className="admin-fila" href={a.href}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className={`icono-circulo ${a.tono}`} aria-hidden="true">
                  <span className="icono">{a.icono}</span>
                </span>
                <div>
                  <div className="admin-fila-nombre">{a.titulo}</div>
                  <div className="admin-fila-slug">{a.sub}</div>
                </div>
              </div>
              <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
