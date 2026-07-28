// Ejecutar vía: npx tsx --conditions=react-server scripts/verificar-0015.ts
// Verificación de SOLO LECTURA de la migración 0015 (antifraude y control de sellos).
// No escribe nada: usa UUIDs inexistentes para probar que las funciones existen y responden.
//
// Si algo falla justo después de aplicar la migración, esperá unos segundos y reintentá: PostgREST
// cachea el esquema y tarda un momento en ver columnas y funciones nuevas.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServiceClient } from '../lib/supabase/server';

// UUID que no existe en ninguna tabla. Las funciones deben responder con su `estado` textual, no
// reventar — que es exactamente lo que queremos comprobar sin escribir una sola fila.
const NADA = '00000000-0000-0000-0000-000000000000';

let fallas = 0;

function ok(mensaje: string) {
  console.log(`OK: ${mensaje}`);
}

function fallo(mensaje: string, detalle?: string) {
  console.error(`FALLO: ${mensaje}${detalle ? ` — ${detalle}` : ''}`);
  fallas += 1;
}

async function main() {
  const supabase = createServiceClient();

  // ── Columnas nuevas del ledger ──
  const ledger = await supabase
    .from('transacciones_puntos')
    .select('tipo, motivo, forzado, monto_compra')
    .limit(1);
  if (ledger.error) {
    fallo('transacciones_puntos no tiene tipo/motivo/forzado/monto_compra', ledger.error.message);
  } else {
    ok('transacciones_puntos tiene tipo, motivo, forzado y monto_compra.');
  }

  // ── Columnas nuevas de comercios ──
  const comercio = await supabase
    .from('comercios')
    .select(
      'tope_acreditaciones_dia, espera_minima_minutos, techo_puntos_acreditacion, ' +
        'tope_puntos_dia, pedir_monto_compra, zona_horaria',
    )
    .limit(1);
  if (comercio.error) {
    fallo('comercios no tiene las seis columnas de control', comercio.error.message);
  } else {
    ok('comercios tiene las cuatro perillas, pedir_monto_compra y zona_horaria.');
  }

  // ── Ningún comercio quedó con límites puestos por accidente ──
  // Toda la seguridad del despliegue depende de esto: las perillas nacen en null, así que el
  // comportamiento del escáner no cambia para NADIE hasta que un dueño configure algo.
  const configurados = await supabase
    .from('comercios')
    .select('nombre, tope_acreditaciones_dia, espera_minima_minutos, zona_horaria')
    .or(
      'tope_acreditaciones_dia.not.is.null,espera_minima_minutos.not.is.null,' +
        'techo_puntos_acreditacion.not.is.null,tope_puntos_dia.not.is.null',
    );
  if (configurados.error) {
    fallo('no se pudo revisar el estado de las perillas', configurados.error.message);
  } else if (configurados.data.length > 0) {
    console.log(
      `AVISO: ${configurados.data.length} comercio(s) ya tienen límites configurados. ` +
        'Es correcto si vos los pusiste; si acabás de migrar, no debería haber ninguno.',
    );
  } else {
    ok('ningún comercio tiene límites configurados (el comportamiento no cambió para nadie).');
  }

  const zonas = await supabase.from('comercios').select('nombre, zona_horaria');
  if (!zonas.error) {
    const raras = zonas.data.filter((c) => c.zona_horaria !== 'America/El_Salvador');
    if (raras.length > 0) {
      console.log(`AVISO: ${raras.length} comercio(s) con zona horaria distinta de El Salvador.`);
    } else {
      ok('todos los comercios quedaron en America/El_Salvador (reporte_tendencia no cambia).');
    }
  }

  // ── Las cinco funciones nuevas existen y responden con su estado textual ──
  const casos: { nombre: string; llamar: () => PromiseLike<{ error: unknown; data: unknown }> }[] = [
    {
      nombre: 'acreditar_atomico',
      llamar: () =>
        supabase.rpc('acreditar_atomico', {
          p_comercio_id: NADA,
          p_tarjeta_id: NADA,
          p_delta: 1,
          p_sucursal_id: null,
          p_cajero_usuario_id: null,
          p_monto_compra: null,
        }),
    },
    {
      nombre: 'acreditar_puntos_atomico (wrapper de compatibilidad)',
      llamar: () =>
        supabase.rpc('acreditar_puntos_atomico', {
          p_comercio_id: NADA,
          p_tarjeta_id: NADA,
          p_delta: 1,
          p_sucursal_id: null,
          p_cajero_usuario_id: null,
        }),
    },
    {
      nombre: 'acreditar_forzado_atomico',
      llamar: () =>
        supabase.rpc('acreditar_forzado_atomico', {
          p_comercio_id: NADA,
          p_tarjeta_id: NADA,
          p_delta: 1,
          p_sucursal_id: null,
          p_cajero_usuario_id: null,
          p_monto_compra: null,
          p_motivo: 'verificacion',
        }),
    },
    {
      nombre: 'ajustar_puntos_atomico',
      llamar: () =>
        supabase.rpc('ajustar_puntos_atomico', {
          p_comercio_id: NADA,
          p_tarjeta_id: NADA,
          p_delta: -1,
          p_sucursal_id: null,
          p_cajero_usuario_id: null,
          p_motivo: 'verificacion',
        }),
    },
    {
      nombre: 'historial_tarjeta',
      llamar: () =>
        supabase.rpc('historial_tarjeta', {
          p_comercio_id: NADA,
          p_tarjeta_id: NADA,
          p_limite: 10,
          p_desde: null,
        }),
    },
    {
      nombre: 'reporte_cajeros',
      llamar: () =>
        supabase.rpc('reporte_cajeros', {
          p_comercio_id: NADA,
          p_desde: null,
          p_hasta: null,
        }),
    },
  ];

  for (const caso of casos) {
    const res = await caso.llamar();
    if (res.error) {
      fallo(`${caso.nombre} no existe o no se puede llamar`, (res.error as Error).message);
    } else {
      ok(`${caso.nombre} existe y responde.`);
    }
  }

  // Las tres funciones de escritura, contra un comercio inexistente, deben decir exactamente
  // 'tarjeta_no_encontrada' — o sea que llegaron a ejecutar su lógica, no que fallaron a medias.
  const acred = await supabase.rpc('acreditar_atomico', {
    p_comercio_id: NADA,
    p_tarjeta_id: NADA,
    p_delta: 1,
    p_sucursal_id: null,
    p_cajero_usuario_id: null,
    p_monto_compra: null,
  });
  const estadoAcred = (acred.data as { estado: string }[] | null)?.[0]?.estado;
  if (estadoAcred === 'tarjeta_no_encontrada') {
    ok("acreditar_atomico devuelve 'tarjeta_no_encontrada' ante un comercio inexistente.");
  } else {
    fallo('acreditar_atomico devolvió un estado inesperado', String(estadoAcred));
  }

  // El motivo vacío se rechaza ANTES de tocar nada: es la garantía de que no hay ajuste sin razón.
  const sinMotivo = await supabase.rpc('ajustar_puntos_atomico', {
    p_comercio_id: NADA,
    p_tarjeta_id: NADA,
    p_delta: -1,
    p_sucursal_id: null,
    p_cajero_usuario_id: null,
    p_motivo: '   ',
  });
  const estadoSinMotivo = (sinMotivo.data as { estado: string }[] | null)?.[0]?.estado;
  if (estadoSinMotivo === 'motivo_requerido') {
    ok("ajustar_puntos_atomico rechaza un motivo en blanco con 'motivo_requerido'.");
  } else {
    fallo('ajustar_puntos_atomico aceptó un motivo en blanco', String(estadoSinMotivo));
  }

  // ── La llave pública NO puede invocar ninguna de las funciones nuevas ──
  // Se comprueba con un cliente ANÓNIMO: el de servicio saltea los permisos por diseño, así que
  // verificar con él no probaría nada. Esta es la defensa contra que alguien tome la anon key del
  // bundle del navegador y se acredite sellos por REST saltándose el gate de la app.
  const { createClient } = await import('@supabase/supabase-js');
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const funcionesProtegidas = [
    ['acreditar_atomico', { p_comercio_id: NADA, p_tarjeta_id: NADA, p_delta: 1, p_sucursal_id: null, p_cajero_usuario_id: null, p_monto_compra: null }],
    ['acreditar_forzado_atomico', { p_comercio_id: NADA, p_tarjeta_id: NADA, p_delta: 1, p_sucursal_id: null, p_cajero_usuario_id: null, p_monto_compra: null, p_motivo: 'x' }],
    ['ajustar_puntos_atomico', { p_comercio_id: NADA, p_tarjeta_id: NADA, p_delta: -1, p_sucursal_id: null, p_cajero_usuario_id: null, p_motivo: 'x' }],
    ['historial_tarjeta', { p_comercio_id: NADA, p_tarjeta_id: NADA, p_limite: 10, p_desde: null }],
    ['reporte_cajeros', { p_comercio_id: NADA, p_desde: null, p_hasta: null }],
  ] as const;

  for (const [nombre, args] of funcionesProtegidas) {
    // `anon` se crea sin el genérico <Database> a propósito: acá lo que se prueba es el permiso de
    // Postgres, no el tipado, y así la llamada dinámica por nombre no pelea con el tipo literal.
    const res = await anon.rpc(nombre, args);
    if (!res.error) {
      fallo(`PROBLEMA GRAVE: la llave pública PUEDE ejecutar ${nombre}. Falta el revoke.`);
    } else {
      ok(`la llave pública no puede ejecutar ${nombre}.`);
    }
  }

  if (fallas > 0) {
    console.error(`\n${fallas} verificación(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nTodo en orden: la migración 0015 está aplicada y protegida.');
  process.exit(0);
}

main();
