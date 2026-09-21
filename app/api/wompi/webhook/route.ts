import { revalidatePath } from 'next/cache';
import { after, NextRequest, NextResponse } from 'next/server';
import { repositorioPagosSupabase } from '@/lib/comercios/repositorioPagosSupabase';
import { notificarPagoAMeta } from '@/lib/marketing/conversionesMeta';
import { createServiceClient } from '@/lib/supabase/server';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import { leerConfigWompi, type ConfigWompi } from '@/lib/wompi/config';
import { procesarWebhook } from '@/lib/wompi/procesarWebhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/wompi/webhook: Wompi avisa aquí de cada transacción EXITOSA (spec 2026-09-21-pasarela-wompi-
// design.md). Es una ruta PÚBLICA a propósito, sin sesión: quien llama es Wompi, no un usuario, y el
// matcher del proxy solo cubre /admin y /comercio. Lo que la protege es la FIRMA (header `wompi_hash`,
// HMAC-SHA256 del cuerpo con el API Secret) y todo lo demás pasa por `procesarWebhook`, que tiene la
// lógica y sus pruebas.
//
// Este archivo solo lee la request y arma las dependencias reales. Dos cosas que importan:
//   - El cuerpo se lee como BYTES (`arrayBuffer`), no como texto: la firma se calcula sobre los bytes
//     exactos que mandó Wompi, y `text()` descarta un BOM inicial.
//   - Si falta el header `wompi_hash` se deja en el log el NOMBRE de los headers recibidos (nunca sus
//     valores): tiene un guion bajo, y algunos proxies descartan los headers con guion bajo. Es el punto
//     2 de "A verificar" en la spec, y este log es lo que lo responde.
export async function POST(request: NextRequest) {
  let config: ConfigWompi;
  try {
    config = leerConfigWompi();
  } catch (error) {
    console.error('[wompi] webhook sin configurar:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'No configurado' }, { status: 500 });
  }

  const cuerpo = new Uint8Array(await request.arrayBuffer());
  const firma = request.headers.get('wompi_hash');
  if (firma === null) {
    console.error('[wompi] webhook sin wompi_hash; headers recibidos:', [...request.headers.keys()].join(', '));
  }

  const supabase = createServiceClient();
  const respuesta = await procesarWebhook(repositorioPagosSupabase(supabase), {
    cuerpo,
    firma,
    secreto: config.clientSecret,
    aceptarPruebas: config.aceptarPruebas,
    hoy: hoyEnZona(null),
    // Pago confirmado = Subscribe para Meta, por la API de conversiones. Con `after` para no hacer
    // esperar a Wompi, y sin poder fallar: `notificarPagoAMeta` no lanza. Se llama UNA vez por cobro de
    // período (ver `confirmarPagoCobro`), así que un reintento del webhook no lo cuenta dos veces.
    alReclamar: (cobro) =>
      after(() => notificarPagoAMeta(supabase, { cuentaId: cobro.cuentaId, cobroId: cobro.id, monto: cobro.monto })),
  });

  // El plan y el cupo los leen varias pantallas del panel (sucursales, el modal de agregar local): sin
  // esto el dueño paga y sigue viendo "alcanzaste el límite" hasta que recargue a mano. Antes lo hacía la
  // acción que subía el plan al instante; ahora el plan cambia acá, cuando el pago se confirma.
  const conciliacion = respuesta.cuerpo.conciliacion;
  if (conciliacion === 'aplicado' || conciliacion === 'plan_no_aplicable') {
    revalidatePath('/comercio', 'layout');
  }

  return NextResponse.json(respuesta.cuerpo, { status: respuesta.estado });
}
