import { PKPass } from 'passkit-generator';
import path from 'node:path';
import { requireEnv } from '@/lib/env';
import { componerStrips, descargarImagen } from './stripPass';

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
  });
  if (strips) {
    pass.addBuffer('strip.png', strips.s1);
    pass.addBuffer('strip@2x.png', strips.s2);
    pass.addBuffer('strip@3x.png', strips.s3);
  }

  if (logo) {
    // Mismo buffer en los tres tamaños: Wallet lo escala (el área del logo es chica).
    pass.addBuffer('logo.png', logo.buf);
    pass.addBuffer('logo@2x.png', logo.buf);
    pass.addBuffer('logo@3x.png', logo.buf);
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

  pass.setBarcodes(datos.qrToken);

  return pass.getAsBuffer();
}
