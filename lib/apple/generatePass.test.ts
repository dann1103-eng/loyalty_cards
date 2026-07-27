import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { generarPassApple } from './generatePass';
import { ALTOS_LOGO } from './imagenesPass';

// PNG de 1×1 para probar la franja subida por el comercio sin depender de la red: fetch() de Node
// soporta data: URLs, así el test compara los bytes exactos que "subió" el comercio.
const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function datosBase() {
  return {
    nombreComercio: 'Cafetería Piloto',
    nombreCliente: 'María Rivera',
    colorFondo: 'rgb(35, 24, 18)',
    colorTexto: 'rgb(255, 255, 255)',
    colorLabel: 'rgb(255, 255, 255)',
    webServiceURL: 'https://example.com/api/apple',
    authenticationToken: '0123456789abcdef0123456789abcdef',
    selloIconoUrl: null,
    heroUrl: null,
    logoUrl: null,
    difuminadoFranja: 'medio',
    // Reverso vacío por defecto: acá se prueba el CABLEADO (que los campos que llegan viajan al
    // pass.json), no qué campos produce construirReverso — eso tiene su propio archivo de pruebas,
    // sin firmar passes ni componer imágenes.
    reverso: [],
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

    // El TITULAR: la tarjeta dice de quién es, como una de socio física. Antes acá iba el nombre
    // del COMERCIO, que ya está arriba en el logo — repetirlo dejaba la tarjeta sin dueño.
    const titular = passJson.storeCard.secondaryFields?.find(
      (f: { key: string }) => f.key === 'titular',
    );
    expect(titular?.value).toBe('María Rivera');
    expect(titular?.textAlignment).toBe('PKTextAlignmentRight');
  });

  it('sin nombre de cliente el pass sale SIN el campo del titular (nunca con "null")', async () => {
    // nombreCliente puede faltar si el join del cliente falla o su fila se borró: el pass tiene que
    // generarse igual. Un campo con la palabra "null" en la billetera del cliente sería peor que
    // no tener campo.
    const buffer = await generarPassApple({
      ...datosBase(),
      nombreCliente: null,
      serialNumber: 'test-serial-sin-cliente',
      qrToken: 'abc123',
      puntos: 3,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    const claves = (passJson.storeCard.secondaryFields ?? []).map((f: { key: string }) => f.key);
    expect(claves).not.toContain('titular');
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

  it('los campos del reverso llegan al pass.json en el mismo orden, con su attributedValue', async () => {
    // Prueba de CABLEADO: que DatosPass.reverso viaje entero hasta los backFields del pass firmado.
    // El orden importa — es el de §3 del spec, lo que el cliente lee de arriba hacia abajo — y
    // FieldsArray descarta en silencio (console.warn, sin lanzar) cualquier campo que no valide,
    // así que un campo perdido no rompería la generación: solo desaparecería de la tarjeta.
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-reverso',
      qrToken: 'rev555',
      puntos: 4,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
      reverso: [
        // Texto plano y multilínea: la forma del pie del emisor, que va en TODOS los passes.
        { key: 'terminos', label: 'Términos de uso', value: '1. Primera.\n2. Segunda.' },
        {
          key: 'instagram',
          label: 'Instagram',
          value: 'https://instagram.com/cafeteria',
          attributedValue: '<a href="https://instagram.com/cafeteria">Instagram</a>',
        },
      ],
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    const backFields = passJson.storeCard.backFields ?? [];

    expect(backFields.map((f: { key: string }) => f.key)).toEqual(['terminos', 'instagram']);
    expect(backFields[0].label).toBe('Términos de uso');
    expect(backFields[0].value).toBe('1. Primera.\n2. Segunda.');
    // Sin esto el link sale como texto muerto: Apple solo lo pinta tocable si viaja el
    // attributedValue, y `value` existe únicamente como degradación legible.
    expect(backFields[1].value).toBe('https://instagram.com/cafeteria');
    expect(backFields[1].attributedValue).toBe('<a href="https://instagram.com/cafeteria">Instagram</a>');
  });

  it('con reverso vacío el pass sale sin backFields (nunca una sección en blanco)', async () => {
    // El caso best-effort de datosPassDeTarjeta: si las consultas de reglas y recompensas fallan,
    // el reverso llega vacío y el pass tiene que emitirse igual. Un cliente con un reverso
    // incompleto está infinitamente mejor que uno sin tarjeta.
    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-reverso-vacio',
      qrToken: 'rev000',
      puntos: 1,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
      reverso: [],
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.storeCard.backFields ?? []).toHaveLength(0);
  });

  it('el nivel de difuminado queda conectado al pass: "ninguno" y "fuerte" con la misma foto producen strips distintos', async () => {
    // Prueba de integración (no solo unitaria de stopsDifuminado): confirma que
    // DatosPass.difuminadoFranja realmente llega hasta el PNG rasterizado, no que se ignora en
    // algún punto del cableado entre generatePass → stripPass.
    const conFoto = {
      ...datosBase(),
      puntos: 3,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
      heroUrl: `data:image/png;base64,${PNG_1PX_B64}`,
    };

    const sinDifuminar = await generarPassApple({ ...conFoto, serialNumber: 'test-difum-ninguno', qrToken: 'd1', difuminadoFranja: 'ninguno' });
    const difuminado = await generarPassApple({ ...conFoto, serialNumber: 'test-difum-fuerte', qrToken: 'd2', difuminadoFranja: 'fuerte' });

    const strip1 = Buffer.from(await (await JSZip.loadAsync(sinDifuminar)).file('strip.png')!.async('nodebuffer'));
    const strip2 = Buffer.from(await (await JSZip.loadAsync(difuminado)).file('strip.png')!.async('nodebuffer'));
    expect(strip1.equals(strip2)).toBe(false);
  });

  it('las TRES densidades del logo llegan al pass distintas y en la caja que les toca', async () => {
    // MUTATION-TESTING: el bug original (el 56% del peso de un pass de 1763 KB) era meter el MISMO
    // buffer en logo.png, @2x y @3x. ESTA es la prueba que lo atrapa, y tiene que vivir acá y no en
    // el presupuesto de peso: desde que el logo se acota también por ALTO, repetir el buffer de @3x
    // engorda el peor caso apenas 79 KB (595 contra 516, medido el 2026-07-26), así que ningún techo
    // de peso razonable lo detecta — con el bug puesto, pesoPass.test.ts sigue verde. Lo que delata
    // el bug es la FORMA del pass, no su peso.
    const logoCuadrado = await sharp(randomBytes(480 * 480 * 3), {
      raw: { width: 480, height: 480, channels: 3 },
    })
      .png()
      .toBuffer();

    const buffer = await generarPassApple({
      ...datosBase(),
      serialNumber: 'test-serial-logo-densidades',
      qrToken: 'log333',
      puntos: 1,
      tipoTarjeta: 'puntos',
      selloMeta: null,
      stripUrl: null,
      logoUrl: `data:image/png;base64,${logoCuadrado.toString('base64')}`,
    });

    const zip = await JSZip.loadAsync(buffer);
    const densidades = await Promise.all(
      ['logo.png', 'logo@2x.png', 'logo@3x.png'].map(async (nombre) =>
        Buffer.from(await zip.file(nombre)!.async('nodebuffer')),
      ),
    );

    // Un logo CUADRADO lo manda el alto del área de Apple (50/100/150), no el ancho: es la forma que
    // más píxeles invisibles arrastraba y la que deja ver que cada densidad se calculó por separado.
    for (const [i, densidad] of densidades.entries()) {
      expect((await sharp(densidad).metadata()).height).toBe(ALTOS_LOGO[i]);
    }

    // Y que sean tres imágenes DISTINTAS: con el bug las tres eran el mismo buffer, byte a byte.
    expect(densidades[0].equals(densidades[1])).toBe(false);
    expect(densidades[1].equals(densidades[2])).toBe(false);
  });
});
