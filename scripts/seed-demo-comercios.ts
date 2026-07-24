// Ejecutar vía: npm run seed-demos
// Crea 5 comercios DEMO 100% personalizados para mostrar a futuros clientes: paleta propia,
// logo monograma generado con next/og, ícono de sello (Twemoji, CC-BY 4.0 — se descarga una vez
// y queda en NUESTRO bucket, sin dependencia del CDN en runtime), imagen principal con gradiente,
// reglas, recompensas y 2 clientes de muestra por comercio con progreso realista (una tarjeta
// LLENA por comercio, para demostrar el canje en vivo).
// Idempotente: si el slug ya existe, ese comercio se salta entero.
import { config } from 'dotenv';
config({ path: '.env.local' });

import crypto from 'node:crypto';
import { ImageResponse } from 'next/og';
import { createServiceClient } from '../lib/supabase/server';
import { registrarCliente } from '../lib/clientes/registrarCliente';
import { acreditarPuntos } from '../lib/comercio/acreditar';

const BUCKET = 'comercio-imagenes';
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72';

interface Demo {
  nombre: string;
  slug: string;
  iniciales: string;
  fondo: string; // rgb(...) — colores del pass
  texto: string;
  label: string;
  tipo: 'puntos' | 'sellos';
  meta: number | null;
  emoji: string; // código twemoji del ícono de sello
  regla: { tipo: 'por_visita' | 'por_monto'; valor: number };
  recompensas: { nombre: string; descripcion: string; costo: number; tipo: string }[];
  clientes: { nombre: string; telefono: string; progreso: number }[];
}

const DEMOS: Demo[] = [
  {
    nombre: 'Café Aurora', slug: 'cafe-aurora-demo', iniciales: 'CA',
    fondo: 'rgb(36, 24, 18)', texto: 'rgb(245, 237, 225)', label: 'rgb(214, 146, 74)',
    tipo: 'sellos', meta: 8, emoji: '2615', // ☕
    regla: { tipo: 'por_visita', valor: 1 },
    recompensas: [
      { nombre: 'Café de la casa gratis', descripcion: 'Cualquier bebida caliente del menú', costo: 8, tipo: 'articulo_gratis' },
      { nombre: 'Postre del día', descripcion: 'Con la compra de cualquier bebida', costo: 5, tipo: 'articulo_gratis' },
    ],
    clientes: [
      { nombre: 'María Rivera', telefono: '+50370000111', progreso: 5 },
      { nombre: 'Carlos Menjívar', telefono: '+50370000112', progreso: 8 },
    ],
  },
  {
    nombre: 'Verde Raíz', slug: 'verde-raiz-demo', iniciales: 'VR',
    fondo: 'rgb(16, 45, 32)', texto: 'rgb(236, 248, 240)', label: 'rgb(126, 217, 158)',
    tipo: 'sellos', meta: 10, emoji: '1f33f', // 🌿
    regla: { tipo: 'por_visita', valor: 1 },
    recompensas: [
      { nombre: 'Smoothie grande gratis', descripcion: 'El sabor que quieras', costo: 10, tipo: 'articulo_gratis' },
      { nombre: '2x1 en bowls', descripcion: 'Válido de lunes a jueves', costo: 6, tipo: 'otro' },
    ],
    clientes: [
      { nombre: 'Ana Portillo', telefono: '+50370000221', progreso: 7 },
      { nombre: 'José Aguilar', telefono: '+50370000222', progreso: 10 },
    ],
  },
  {
    nombre: 'Brasa Urbana', slug: 'brasa-urbana-demo', iniciales: 'BU',
    fondo: 'rgb(26, 20, 20)', texto: 'rgb(250, 244, 240)', label: 'rgb(255, 122, 69)',
    tipo: 'puntos', meta: null, emoji: '1f354', // 🍔 (para branding; el pass de puntos usa banda)
    regla: { tipo: 'por_monto', valor: 1 },
    recompensas: [
      { nombre: 'Combo clásico gratis', descripcion: 'Hamburguesa + papas + soda', costo: 100, tipo: 'articulo_gratis' },
      { nombre: 'Papas grandes gratis', descripcion: 'Con cualquier compra', costo: 50, tipo: 'articulo_gratis' },
    ],
    clientes: [
      { nombre: 'Lucía Campos', telefono: '+50370000331', progreso: 35 },
      { nombre: 'Diego Flores', telefono: '+50370000332', progreso: 80 },
    ],
  },
  {
    nombre: 'Dulce Nube', slug: 'dulce-nube-demo', iniciales: 'DN',
    fondo: 'rgb(52, 32, 52)', texto: 'rgb(252, 240, 248)', label: 'rgb(255, 158, 196)',
    tipo: 'sellos', meta: 6, emoji: '1f369', // 🍩
    regla: { tipo: 'por_visita', valor: 1 },
    recompensas: [
      { nombre: 'Dona rellena gratis', descripcion: 'De la vitrina del día', costo: 6, tipo: 'articulo_gratis' },
    ],
    clientes: [
      { nombre: 'Sofía Ramos', telefono: '+50370000441', progreso: 4 },
      { nombre: 'Andrés Molina', telefono: '+50370000442', progreso: 6 },
    ],
  },
  {
    nombre: 'Barbería El Puerto', slug: 'barberia-el-puerto-demo', iniciales: 'BP',
    fondo: 'rgb(16, 28, 44)', texto: 'rgb(238, 244, 250)', label: 'rgb(212, 175, 110)',
    tipo: 'sellos', meta: 5, emoji: '2702', // ✂️
    regla: { tipo: 'por_visita', valor: 1 },
    recompensas: [
      { nombre: 'Corte gratis', descripcion: 'El sexto corte va por la casa', costo: 5, tipo: 'articulo_gratis' },
      { nombre: 'Arreglo de barba', descripcion: 'Con cualquier corte', costo: 3, tipo: 'articulo_gratis' },
    ],
    clientes: [
      { nombre: 'Valeria Cruz', telefono: '+50370000551', progreso: 3 },
      { nombre: 'Mario Chávez', telefono: '+50370000552', progreso: 5 },
    ],
  },
];

/* ---------- generación de assets ---------- */

async function pngDe(img: ImageResponse): Promise<Buffer> {
  return Buffer.from(await img.arrayBuffer());
}

// Logo monograma con fondo TRANSPARENTE: en el pass real el logo se apoya directo sobre el color
// de la tarjeta — un fondo sólido se veía como un cuadrote pegado cuando el dueño cambiaba el
// color (visto en el piloto con Café Aurora en granate).
function renderLogo(d: Demo): ImageResponse {
  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
        },
        children: [{
          type: 'div',
          props: {
            style: {
              width: 440, height: 440, borderRadius: 9999, display: 'flex', alignItems: 'center',
              justifyContent: 'center', border: `16px solid ${d.label}`,
              color: d.texto, fontSize: 180, fontWeight: 700, fontFamily: 'sans-serif', letterSpacing: -6,
            },
            children: d.iniciales,
          },
        }],
      },
    } as unknown as React.ReactElement,
    { width: 512, height: 512 },
  );
}

// Imagen principal: gradiente de marca con resplandores (para la vista previa del editor).
function renderHero(d: Demo): ImageResponse {
  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          width: '100%', height: '100%', display: 'flex', position: 'relative',
          background: `linear-gradient(135deg, ${d.fondo} 0%, ${d.label} 260%)`,
        },
        children: [
          { type: 'div', props: { style: { position: 'absolute', right: -120, top: -120, width: 480, height: 480, borderRadius: 9999, background: d.label, opacity: 0.22 } } },
          { type: 'div', props: { style: { position: 'absolute', left: -80, bottom: -160, width: 380, height: 380, borderRadius: 9999, background: d.label, opacity: 0.1 } } },
        ],
      },
    } as unknown as React.ReactElement,
    { width: 1200, height: 675 },
  );
}

/* ---------- seed ---------- */

async function main() {
  const supabase = createServiceClient();
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('NEXT_PUBLIC_BASE_URL requerida (para nada en este seed, pero valida el .env)');

  for (const d of DEMOS) {
    const { data: existente } = await supabase.from('comercios').select('id').eq('slug', d.slug).maybeSingle();
    if (existente) {
      console.log(`↷ ${d.nombre} (${d.slug}) ya existe; se salta.`);
      continue;
    }

    // 0. Cuenta (cliente que paga) del demo: una por comercio, límite 1. Se crea dentro de la rama
    //    "no existe" (arriba se hace continue si el slug ya está), así que re-correr el seed no
    //    acumula cuentas huérfanas — misma idempotencia por slug que el resto.
    const { data: cuenta, error: eCuenta } = await supabase
      .from('cuentas_comercio')
      .insert({ nombre: d.nombre, limite_negocios: 1 })
      .select('id')
      .single();
    if (eCuenta) throw eCuenta;

    // 1. Comercio (colores + tipo + licencia demo + cuenta).
    const { data: comercio, error: eC } = await supabase
      .from('comercios')
      .insert({
        nombre: d.nombre, slug: d.slug,
        color_fondo: d.fondo, color_texto: d.texto, color_label: d.label,
        tipo_tarjeta: d.tipo, sello_meta: d.meta,
        licencia_estado: 'activo', licencia_plan: 'Demo',
        cuenta_id: cuenta.id,
      })
      .select('id')
      .single();
    if (eC) throw eC;
    const comercioId = comercio.id;

    // 2. Assets → bucket (misma convención de rutas que el panel: {comercioId}/{campo}.png).
    const logo = await pngDe(renderLogo(d));
    const hero = await pngDe(renderHero(d));
    const resIcono = await fetch(`${TWEMOJI}/${d.emoji}.png`);
    if (!resIcono.ok) throw new Error(`Twemoji ${d.emoji} respondió ${resIcono.status}`);
    const icono = Buffer.from(await resIcono.arrayBuffer());

    const subir = async (campo: string, buf: Buffer) => {
      const ruta = `${comercioId}/${campo}.png`;
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: 'image/png', upsert: true });
      if (error) throw error;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
      return `${pub.publicUrl}?v=${crypto.randomBytes(4).toString('hex')}`;
    };

    const [logoUrl, heroUrl, iconoUrl] = [await subir('logo', logo), await subir('hero', hero), await subir('sello_icono', icono)];
    const { error: eU } = await supabase
      .from('comercios')
      .update({ logo_url: logoUrl, hero_url: heroUrl, sello_icono_url: iconoUrl })
      .eq('id', comercioId);
    if (eU) throw eU;

    // 3. Regla + recompensas.
    const { error: eR } = await supabase.from('reglas_puntos').insert({ comercio_id: comercioId, ...({ tipo: d.regla.tipo, valor: d.regla.valor }) });
    if (eR) throw eR;
    const { error: eRec } = await supabase.from('recompensas').insert(
      d.recompensas.map((r) => ({ comercio_id: comercioId, nombre: r.nombre, descripcion: r.descripcion, costo_puntos: r.costo, tipo: r.tipo, activa: true })),
    );
    if (eRec) throw eRec;

    // 4. Clientes demo por el flujo REAL (registrarCliente + init de Apple como /api/registro +
    //    acreditaciones que dejan ledger — los demos se comportan igual que datos reales).
    for (const c of d.clientes) {
      const registro = await registrarCliente(supabase, comercioId, c.nombre, c.telefono);
      const authToken = crypto.randomBytes(16).toString('hex');
      await supabase
        .from('tarjetas')
        .update({ apple_auth_token: authToken, apple_serial_number: registro.tarjetaId })
        .eq('id', registro.tarjetaId)
        .is('apple_serial_number', null);
      if (c.progreso > 0) {
        const res = await acreditarPuntos(supabase, comercioId, registro.tarjetaId, c.progreso);
        if (!res.ok) throw new Error(`acreditar demo falló (${c.nombre}): ${res.error}`);
      }
    }

    console.log(`✓ ${d.nombre} — ${d.tipo}${d.meta ? ` (meta ${d.meta})` : ''}, ${d.recompensas.length} recompensas, ${d.clientes.length} clientes demo. /registro/${d.slug}`);
  }

  console.log('Listo. Los comercios demo aparecen en /admin/comercios y cada uno tiene su QR de registro.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
