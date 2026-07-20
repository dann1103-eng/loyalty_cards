import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generarPassApple } from './generatePass';

// PNG de 1×1 para probar la franja subida por el comercio sin depender de la red: fetch() de Node
// soporta data: URLs, así el test compara los bytes exactos que "subió" el comercio.
const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function datosBase() {
  return {
    nombreComercio: 'Cafetería Piloto',
    colorFondo: 'rgb(35, 24, 18)',
    colorTexto: 'rgb(255, 255, 255)',
    colorLabel: 'rgb(255, 255, 255)',
    webServiceURL: 'https://example.com/api/apple',
    authenticationToken: '0123456789abcdef0123456789abcdef',
  };
}

describe('generarPassApple', () => {
  it('genera un .pkpass válido con los campos esperados', async () => {
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-001',
      qrToken: 'abc123',
      puntos: 10,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
    });

    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['pass.json', 'manifest.json', 'signature', 'icon.png']),
    );

    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.serialNumber).toBe('test-serial-001');
    expect(passJson.storeCard.primaryFields[0].value).toBe(10);
    expect(passJson.barcodes[0].message).toBe('abc123');
    expect(passJson.webServiceURL).toBe('https://example.com/api/apple');
    expect(passJson.authenticationToken).toBe('0123456789abcdef0123456789abcdef');
    // Aun sin imagen del comercio, el pass lleva una franja compuesta (banda de marca) en los
    // tres tamaños. La composición es best-effort, pero en el entorno de pruebas debe funcionar.
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['strip.png', 'strip@2x.png', 'strip@3x.png']),
    );
  });

  it('el passTypeIdentifier y teamIdentifier del pass firmado vienen de env (fuente única)', async () => {
    // Verifica que el override de env realmente gana sobre pass.json. Si passkit-generator
    // ignorara estos campos, el push fallaría en silencio (topic APNs ≠ passTypeIdentifier del
    // pass); este test lo detectaría en vez de descubrirlo en un iPhone real.
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-002',
      qrToken: 'xyz789',
      puntos: 0,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.passTypeIdentifier).toBe(process.env.APPLE_PASS_TYPE_IDENTIFIER);
    expect(passJson.teamIdentifier).toBe(process.env.APPLE_TEAM_ID);
  });

  it('sellos con meta: la grilla va en la franja y el contador debajo (secondary)', async () => {
    // Evolución del contrato original ("texto en primaryFields"): ahora que next/og puede
    // componer imágenes, la grilla de sellos SE VE en el strip. El texto encima de la grilla
    // taparía los círculos, así que el contador baja a secondaryFields.
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-sellos',
      qrToken: 'sel777',
      puntos: 7,
      tipoTarjeta: 'sellos',
      selloMeta: 10,
      stripUrl: null,
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['strip.png', 'strip@2x.png', 'strip@3x.png']),
    );
    expect(passJson.storeCard.primaryFields ?? []).toHaveLength(0);
    expect(passJson.storeCard.secondaryFields[0].label).toBe('SELLOS');
    expect(passJson.storeCard.secondaryFields[0].value).toBe('7 de 10');
  });

  it('vuelve al número si tipo=sellos pero sello_meta es null (fallback seguro)', async () => {
    // FM puede poner tipo='sellos' antes de que el dueño configure la meta. Sin meta no hay
    // denominador ni grilla, así que se renderiza el número — nunca "7 de  sellos".
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-sellos-sinmeta',
      qrToken: 'sel000',
      puntos: 7,
      tipoTarjeta: 'sellos',
      selloMeta: null,
      stripUrl: null,
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.storeCard.primaryFields[0].value).toBe(7);
  });

  it('usa la franja subida por el comercio cuando existe (bytes exactos)', async () => {
    const esperado = Buffer.from(PNG_1PX_B64, 'base64');
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-strip-propia',
      qrToken: 'str111',
      puntos: 2,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: `data:image/png;base64,${PNG_1PX_B64}`,
    });

    const zip = await JSZip.loadAsync(buffer);
    const guardado = Buffer.from(await zip.file('strip.png')!.async('nodebuffer'));
    expect(guardado.equals(esperado)).toBe(true);
  });
});
