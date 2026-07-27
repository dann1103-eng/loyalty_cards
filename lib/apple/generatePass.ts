import { PKPass } from 'passkit-generator';
import path from 'node:path';
import { requireEnv } from '@/lib/env';
import { componerStrips, descargarImagen } from './stripPass';
import { redimensionarLogo } from './imagenesPass';
import type { CampoReverso } from './construirReverso';

function cargarCertificados() {
  return {
    wwdr: Buffer.from(requireEnv('APPLE_WWDR_B64'), 'base64'),
    signerCert: Buffer.from(requireEnv('APPLE_SIGNER_CERT_B64'), 'base64').toString('utf-8'),
    signerKey: Buffer.from(requireEnv('APPLE_SIGNER_KEY_B64'), 'base64').toString('utf-8'),
  };
}

export interface DatosPass {
  serialNumber: string;
  qrToken: string;
  puntos: number;
  // Titular de la tarjeta (clientes.nombre). null si no se pudo resolver: el pass sale sin el campo.
  nombreCliente: string | null;
  nombreComercio: string;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  webServiceURL: string;
  authenticationToken: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  difuminadoFranja: string;
  // Campos del reverso del pass, ya armados por construirReverso. Arreglo vacio = pass sin reverso
  // (es lo que pasa si las consultas de reglas/recompensas fallan: best-effort, ver datosPassDeTarjeta).
  //
  // OBLIGATORIO a proposito, no `reverso?:`: hacerlo opcional dejaria que una ruta de emision nueva
  // arme un pass sin pasar por el constructor del reverso y nadie se enteraria — el pass saldria
  // mudo al tocar la "i" y ninguna prueba lo atraparia.
  reverso: CampoReverso[];
}

export async function generarPassApple(datos: DatosPass): Promise<Buffer> {
  // Logo del comercio (esquina superior del pass), best-effort. Con logo propio se OMITE el
  // logoText: Apple los pone lado a lado y el nombre ya aparece grande en el cuerpo del pass
  // (referencia del usuario: los passes de la competencia muestran solo el logo).
  const logo = await descargarImagen(datos.logoUrl, 'el logo del comercio');

  const pass = await PKPass.from(
    {
      model: path.join(process.cwd(), 'passModels', 'loyalty.pass'),
      certificates: cargarCertificados(),
    },
    {
      // passTypeIdentifier/teamIdentifier vienen de env (misma fuente que usa el push APNs:
      // topic = APPLE_PASS_TYPE_IDENTIFIER, JWT = APPLE_TEAM_ID). Sobrescriben lo que trae
      // pass.json, así env es la ÚNICA fuente de verdad. Sin esto, un valor de env distinto al
      // de pass.json haría que el push nunca llegue (topic ≠ passTypeIdentifier del pass), y
      // fallaría en silencio justo en el paso que este skeleton valida.
      passTypeIdentifier: requireEnv('APPLE_PASS_TYPE_IDENTIFIER'),
      teamIdentifier: requireEnv('APPLE_TEAM_ID'),
      serialNumber: datos.serialNumber,
      organizationName: datos.nombreComercio,
      description: `Tarjeta de lealtad de ${datos.nombreComercio}`,
      ...(logo ? {} : { logoText: datos.nombreComercio }),
      backgroundColor: datos.colorFondo,
      foregroundColor: datos.colorTexto,
      labelColor: datos.colorLabel,
      webServiceURL: datos.webServiceURL,
      authenticationToken: datos.authenticationToken,
    },
  );

  pass.type = 'storeCard';

  // Franja visual (best-effort, nunca rompe la emisión): la imagen del comercio si subió una;
  // si no, para sellos una GRILLA de círculos llenos/vacíos compuesta con next/og, y para el
  // resto una banda sutil con los colores de la marca. (Evolución del contrato original de la
  // Fase 3, que era solo-texto porque entonces no había pipeline de imágenes.)
  const strips = await componerStrips({
    tipoTarjeta: datos.tipoTarjeta,
    puntos: datos.puntos,
    selloMeta: datos.selloMeta,
    colorFondo: datos.colorFondo,
    colorLabel: datos.colorLabel,
    stripUrl: datos.stripUrl,
    selloIconoUrl: datos.selloIconoUrl,
    heroUrl: datos.heroUrl,
    difuminadoFranja: datos.difuminadoFranja,
  });
  if (strips) {
    pass.addBuffer('strip.png', strips.s1);
    pass.addBuffer('strip@2x.png', strips.s2);
    pass.addBuffer('strip@3x.png', strips.s3);
  }

  if (logo) {
    // Cada densidad a SU ancho (160/320/480 px). Antes iba el mismo buffer de 480 px en las tres,
    // "porque Wallet lo escala": eran 331 KB × 3 = 993 KB, el 56% de un pass de 1763 KB, para un
    // área de ~50 px de alto. Y el iPhone se baja el pass ENTERO cada vez que se acredita un punto,
    // así que ese peso se pagaba en CADA compra — el dueño reportó que la tarjeta tardaba en verse
    // actualizada (producción, 2026-07-26).
    const [logo1x, logo2x, logo3x] = await redimensionarLogo(logo.buf);
    pass.addBuffer('logo.png', logo1x);
    pass.addBuffer('logo@2x.png', logo2x);
    pass.addBuffer('logo@3x.png', logo3x);
  }

  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  if (esSellos && strips && !datos.stripUrl) {
    // La grilla se VE en la franja; texto encima taparía los círculos (los primaryFields de un
    // storeCard se dibujan sobre el strip). El contador baja a secondaryFields, debajo.
    pass.secondaryFields.push({
      key: 'puntos',
      label: 'SELLOS',
      value: `${datos.puntos} de ${datos.selloMeta}`,
    });
  } else if (esSellos) {
    // Sin grilla (composición falló, o el comercio usa SU franja): el texto vuelve al campo
    // primario — mismo fallback seguro de siempre.
    pass.primaryFields.push({
      key: 'puntos',
      label: 'SELLOS',
      value: `${datos.puntos} de ${datos.selloMeta} sellos`,
    });
  } else {
    pass.primaryFields.push({
      key: 'puntos',
      label: 'PUNTOS',
      value: datos.puntos,
      numberStyle: 'PKNumberStyleDecimal',
    });
  }

  // El TITULAR de la tarjeta, alineado a la derecha de la misma fila que el contador. Es el nombre
  // que el cliente escribió al registrarse — como una tarjeta de socio física, que lleva el nombre
  // de quien la usa. El nombre del COMERCIO no va acá: ya está arriba (logo, o logoText cuando no
  // hay logo) y repetirlo dejaba la tarjeta sin decir de quién es.
  // Se omite si falta: una tarjeta sin nombre es mejor que una que diga "null".
  if (datos.nombreCliente) {
    pass.secondaryFields.push({
      key: 'titular',
      value: datos.nombreCliente,
      textAlignment: 'PKTextAlignmentRight',
    });
  }

  // El REVERSO (lo que ve el cliente al tocar la "i"), ya armado por construirReverso. De a uno y
  // no `push(...datos.reverso)`: FieldsArray valida cada campo y DESCARTA el inválido con un
  // console.warn sin lanzar (FieldsArray.js, registerWithValidation), así que empujarlos uno por
  // uno no cambia el comportamiento pero deja el bucle donde se puede depurar cuál se perdió.
  for (const campo of datos.reverso) {
    pass.backFields.push(campo);
  }

  pass.setBarcodes(datos.qrToken);

  return pass.getAsBuffer();
}
