import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import JSZip from 'jszip';
import { randomBytes } from 'node:crypto';
import { generarPassApple } from './generatePass';
import { PRESUPUESTO_PASS_KB } from './imagenesPass';
import { LADOS_MAXIMOS } from '@/lib/comercio/redimensionarImagen';

// EL PRESUPUESTO DE PESO DEL PASS: la prueba que impide que vuelva el problema del 2026-07-26 (pass
// de 1763 KB, tarjetas que tardaban en verse actualizadas porque el iPhone se baja el pass ENTERO
// cada vez que se acredita un punto).
//
// Ya existe scripts/verificar-wallet.ts, que mide lo mismo contra producción — pero un script solo
// protege si alguien se acuerda de correrlo, y de esto justamente nadie se acuerda hasta que un
// dueño reporta que su tarjeta va lenta. Esta prueba corre sola en cada cambio.
//
// El presupuesto NO se escribe acá: se importa de imagenesPass.ts, el mismo que importa el script.

// El peor caso que la app puede llegar a meter en un pass, construido en el propio test para que
// crezca solo si alguien sube los topes de subida (LADOS_MAXIMOS, lib/comercio/redimensionarImagen).
// Nada de PNG de 1 px: con imágenes de juguete el pass pesa lo mismo con el bug y sin él, y esta
// prueba pasaría siempre sin proteger nada.
//
// Ruido a todo color = lo que PEOR comprime. PNG comprime buscando repetición y en ruido no hay
// ninguna, así que este archivo pesa el TECHO de lo que puede pesar una imagen de ese tamaño: la
// foto más recargada que suba un comercio real siempre comprime mejor. Si el pass entra en el
// presupuesto con esto adentro, entra con cualquier cosa.
async function imagenDeRuido(lado: number): Promise<string> {
  const png = await sharp(randomBytes(lado * lado * 3), {
    raw: { width: lado, height: lado, channels: 3 },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// MUTATION-TESTING (corrido y medido el 2026-07-26, no estimado): revertir cualquiera de los dos
// arreglos de peso pone esta prueba en rojo, contra los 1458 KB que mide con el código sano.
//   - meter el MISMO buffer en las tres densidades del logo en generatePass.ts (el bug original,
//     el 56% del peso del pass: 993 KB de 1763) → 2463 KB;
//   - devolver la salida de next/og sin pasarla por comprimirPng en stripPass.tsx → 2346 KB.
// Las dos fallan por el peso, que es la razón correcta, y el desglose del mensaje señala cuál fue.
describe('presupuesto de peso del .pkpass', () => {
  it('un pass con el logo y la foto más pesados que la app acepta entra en el presupuesto', async () => {
    // Tarjeta de SELLOS con foto de fondo: el camino más caro de los que existen. La franja se
    // compone con next/og sobre la foto y sale en tres tamaños (375/750/1125 px de ancho), así que
    // acá se pagan a la vez las tres franjas Y las tres densidades del logo.
    const [logo, hero] = await Promise.all([
      imagenDeRuido(LADOS_MAXIMOS.logo),
      imagenDeRuido(LADOS_MAXIMOS.hero),
    ]);

    const buffer = await generarPassApple({
      serialNumber: 'test-presupuesto-peso',
      qrToken: 'peso001',
      puntos: 7,
      nombreCliente: 'María Rivera',
      nombreComercio: 'Comercio Recargado',
      colorFondo: 'rgb(35, 24, 18)',
      colorTexto: 'rgb(255, 255, 255)',
      colorLabel: 'rgb(255, 255, 255)',
      webServiceURL: 'https://example.com/api/apple',
      authenticationToken: '0123456789abcdef0123456789abcdef',
      tipoTarjeta: 'sellos',
      selloMeta: 10,
      stripUrl: null,
      selloIconoUrl: null,
      heroUrl: hero,
      logoUrl: logo,
      difuminadoFranja: 'medio',
      reverso: [],
    });

    const kb = buffer.length / 1024;

    // El desglose por archivo va en el mensaje de la falla, no en un console.log: cuando esta prueba
    // se ponga roja dentro de un año, lo primero que hay que saber es QUÉ engordó, y buscar eso a
    // mano cuesta media hora. La franja y el logo son los dos únicos sospechosos serios.
    const zip = await JSZip.loadAsync(buffer);
    const desglose = await Promise.all(
      Object.keys(zip.files)
        .sort()
        .map(async (nombre) => {
          const bytes = (await zip.file(nombre)!.async('nodebuffer')).length;
          return `  ${nombre.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(6)} KB`;
        }),
    );

    expect(
      kb,
      `El pass pesa ${kb.toFixed(0)} KB y el presupuesto es ${PRESUPUESTO_PASS_KB} KB.\n` +
        'El iPhone se baja el pass ENTERO cada vez que se acredita un punto: pasado este peso, la\n' +
        'tarjeta del cliente empieza a tardar en verse actualizada (reportado en producción el\n' +
        '2026-07-26 con un pass de 1763 KB). Desglose de este pass:\n' +
        desglose.join('\n') +
        '\nSi es el logo: revisá que generatePass.ts siga metiendo las TRES densidades distintas de\n' +
        'redimensionarLogo y no el mismo buffer tres veces. Si es la franja: que stripPass.tsx siga\n' +
        'pasando cada salida de next/og por comprimirPng.',
    ).toBeLessThan(PRESUPUESTO_PASS_KB);
  });
});
