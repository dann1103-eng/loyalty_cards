import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { PDFDocument } from 'pdf-lib';
import { createServiceClient } from '@/lib/supabase/server';
import { DIMENSIONES_CARTEL } from '@/lib/comercio/cartel/tipos';
import { crearEntorno } from '@/test/fixtures/entornoComercio';

// Mismo motivo que en actions.test.ts: el gate necesita cookies de una request real. Lo que se
// prueba acá NO es el gate sino que su comercioId sea lo único que decide qué cartel se entrega —
// con el mock, la prueba puede pedir el cartel de un programa ajeno, que es lo que consigue
// cualquiera editando el [id] de la URL.
const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);
const comerciosCreados: string[] = [];

async function armarComercio(): Promise<{ comercioId: string; comercioSlug: string; programaId: string }> {
  // Slug propio para poder asertar la URL del QR carácter por carácter (mismo criterio que
  // resolverDatosCartel.test.ts): sin conocerlo, lo único aserteable sería "contiene /registro/".
  const comercioSlug = `cartel-ruta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const comercioId = await entorno.crearComercio({ slug: comercioSlug });
  comerciosCreados.push(comercioId);
  return { comercioId, comercioSlug, programaId: entorno.obtenerProgramaPrincipal(comercioId) };
}

async function descargar(programaId: string, consulta: string) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost/x?${consulta}`), {
    params: Promise.resolve({ id: programaId }),
  });
}

beforeEach(() => {
  sesion.comercioId = '';
});

afterEach(async () => {
  if (comerciosCreados.length) {
    const { error } = await supabase.from('disenos_cartel').delete().in('comercio_id', comerciosCreados);
    if (error) console.error('[test] no se pudo limpiar disenos_cartel:', error);
    comerciosCreados.length = 0;
  }
  await entorno.limpiar();
});

describe('GET /comercio/programas/[id]/cartel/descargar', () => {
  it('devuelve 404 —no el cartel— si el programa es de OTRO comercio', async () => {
    const propio = await armarComercio();
    const ajeno = await armarComercio();
    sesion.comercioId = ajeno.comercioId;

    const r = await descargar(propio.programaId, 'formato=sticker&tipo=png');

    // 404 y no 403: un 403 le confirmaría a quien prueba ids al azar que ese programa existe.
    expect(r.status).toBe(404);
    expect(r.headers.get('Content-Type')).toContain('application/json');
  });

  it('rechaza un formato que no existe', async () => {
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await descargar(programaId, 'formato=gigantografia&tipo=png');

    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toEqual({ error: 'Parámetros de descarga inválidos.' });
  });

  it('rechaza un tipo de archivo que no existe', async () => {
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await descargar(programaId, 'formato=sticker&tipo=svg');

    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toEqual({ error: 'Parámetros de descarga inválidos.' });
  });

  it('el PNG del sticker se descarga con el tamaño real del papel y el QR de ESE programa', async () => {
    const { comercioId, comercioSlug, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await descargar(programaId, 'formato=sticker&tipo=png');

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('image/png');
    // Sin el attachment, el navegador ABRE el PNG en una pestaña en vez de bajarlo.
    expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="cartel-sticker.png"');
    // Un cartel cacheado seguiría entregando el diseño viejo después de editarlo.
    expect(r.headers.get('Cache-Control')).toBe('no-store');

    const png = Buffer.from(await r.arrayBuffer());
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(DIMENSIONES_CARTEL.sticker.px.ancho);
    expect(meta.height).toBe(DIMENSIONES_CARTEL.sticker.px.alto);

    // Que el archivo mida lo que tiene que medir no dice NADA de si el QR impreso lleva a algún
    // lado: se decodifica con el mismo lector que usa el escáner del comercio, y se compara contra
    // la URL de registro de ESTE programa. Es lo único que ata la ruta al programa del [id].
    const { data, info } = await sharp(png).resize(600, 600).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const leido = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    expect(new URL(leido?.data ?? 'http://sin-qr.invalid').pathname).toBe(`/registro/${comercioSlug}`);
  }, 30_000);

  it('el PDF del mostrador sale en A5, con el formato que pidió la URL', async () => {
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;

    const r = await descargar(programaId, 'formato=mostrador&tipo=pdf');

    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/pdf');
    expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="cartel-mostrador.pdf"');

    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.subarray(0, 5).toString(), 'tiene que ser un PDF de verdad').toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    const { width, height } = pdf.getPage(0).getSize();
    // Media hoja carta/A4: si la ruta ignorara el `formato` de la URL y usara siempre el sticker,
    // el dueño imprimiría un cuadrado de 10 cm creyendo que pidió el cartel de mostrador.
    expect(width).toBeCloseTo(DIMENSIONES_CARTEL.mostrador.pt.ancho, 1);
    expect(height).toBeCloseTo(DIMENSIONES_CARTEL.mostrador.pt.alto, 1);
  }, 30_000);

  it('un programa desactivado se puede seguir descargando', async () => {
    const { comercioId, programaId } = await armarComercio();
    sesion.comercioId = comercioId;
    await supabase.from('programas_tarjeta').update({ activo: false }).eq('id', programaId);

    const r = await descargar(programaId, 'formato=sticker&tipo=png');

    // Decisión del spec §7: el aviso de "este QR ya no registra clientes" es informativo en la
    // pantalla del editor, no un bloqueo — el dueño puede querer el archivo para su archivo.
    expect(r.status).toBe(200);
  }, 30_000);
});
