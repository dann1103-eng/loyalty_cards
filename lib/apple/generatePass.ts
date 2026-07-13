import { PKPass } from 'passkit-generator';
import path from 'node:path';
import { requireEnv } from '@/lib/env';

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
}

export async function generarPassApple(datos: DatosPass): Promise<Buffer> {
  const pass = await PKPass.from(
    {
      model: path.join(process.cwd(), 'passModels', 'loyalty.pass'),
      certificates: cargarCertificados(),
    },
    {
      serialNumber: datos.serialNumber,
      organizationName: datos.nombreComercio,
      description: `Tarjeta de lealtad de ${datos.nombreComercio}`,
      logoText: datos.nombreComercio,
      backgroundColor: datos.colorFondo,
      foregroundColor: datos.colorTexto,
      labelColor: datos.colorLabel,
      webServiceURL: datos.webServiceURL,
      authenticationToken: datos.authenticationToken,
    },
  );

  pass.type = 'storeCard';
  pass.primaryFields.push({
    key: 'puntos',
    label: 'PUNTOS',
    value: datos.puntos,
    numberStyle: 'PKNumberStyleDecimal',
  });
  pass.setBarcodes(datos.qrToken);

  return pass.getAsBuffer();
}
