import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generarPassApple } from './generatePass';

describe('generarPassApple', () => {
  it('genera un .pkpass válido con los campos esperados', async () => {
    const buffer = await generarPassApple({
      serialNumber: 'test-serial-001',
      qrToken: 'abc123',
      puntos: 10,
      nombreComercio: 'Cafetería Piloto',
      colorFondo: 'rgb(35, 24, 18)',
      colorTexto: 'rgb(255, 255, 255)',
      colorLabel: 'rgb(255, 255, 255)',
      webServiceURL: 'https://example.com/api/apple',
      authenticationToken: '0123456789abcdef0123456789abcdef',
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
  });

  it('el passTypeIdentifier y teamIdentifier del pass firmado vienen de env (fuente única)', async () => {
    // Verifica que el override de env realmente gana sobre pass.json. Si passkit-generator
    // ignorara estos campos, el push fallaría en silencio (topic APNs ≠ passTypeIdentifier del
    // pass); este test lo detectaría en vez de descubrirlo en un iPhone real.
    const buffer = await generarPassApple({
      serialNumber: 'test-serial-002',
      qrToken: 'xyz789',
      puntos: 0,
      nombreComercio: 'Cafetería Piloto',
      colorFondo: 'rgb(35, 24, 18)',
      colorTexto: 'rgb(255, 255, 255)',
      colorLabel: 'rgb(255, 255, 255)',
      webServiceURL: 'https://example.com/api/apple',
      authenticationToken: '0123456789abcdef0123456789abcdef',
    });

    const zip = await JSZip.loadAsync(buffer);
    const passJson = JSON.parse(await zip.file('pass.json')!.async('string'));
    expect(passJson.passTypeIdentifier).toBe(process.env.APPLE_PASS_TYPE_IDENTIFIER);
    expect(passJson.teamIdentifier).toBe(process.env.APPLE_TEAM_ID);
  });
});
