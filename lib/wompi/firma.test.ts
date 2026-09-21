import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { firmaHmac, firmaValida, hashRedirectValido, textoHashRedirect } from './firma';

// El vector se arma acá con node:crypto y NO con los ejemplos de la doc de Wompi: esos traen un hash
// pero no el secreto con que se firmaron, así que no sirven para verificar nada.
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - decodificar a texto antes de firmar                          → falla "un BOM inicial cuenta"
//   - quitar el chequeo de longitud antes de timingSafeEqual        → falla "una firma ausente, vacía o de otro largo… NO lanza"
//   - no pasar a minúsculas                                         → falla "acepta el hexadecimal en mayúsculas"
//   - invertir idTransaccion e idEnlace en el hash del redirect     → fallan "concatena en el orden de la doc" y "con otro orden…"
//   - reformatear el monto                                          → fallan "concatena en el orden de la doc" y "el monto va como llegó"
// Que la RUTA firme los bytes recibidos y no un JSON re-serializado NO se prueba acá (firmaValida solo
// ve lo que le pasan): lo prueba procesarWebhook.test.ts.

const SECRETO = 'secreto-de-prueba';

describe('firmaValida', () => {
  it('acepta la firma de un cuerpo', () => {
    const cuerpo = '{"IdTransaccion":"abc","Monto":49}';
    expect(firmaValida(firmaHmac(cuerpo, SECRETO), cuerpo, SECRETO)).toBe(true);
  });

  it('firma el cuerpo TAL CUAL llegó: un espacio o un salto de línea de más cambia la firma', () => {
    const tal = '{ "IdTransaccion": "abc",\n  "Monto": 49 }';
    const firma = createHmac('sha256', SECRETO).update(tal).digest('hex');
    // Si se re-serializara (JSON.stringify(JSON.parse(tal))) la firma sería otra.
    expect(firmaValida(firma, tal, SECRETO)).toBe(true);
    expect(firmaValida(firma, JSON.stringify(JSON.parse(tal)), SECRETO)).toBe(false);
  });

  it('un BOM inicial cuenta: se firma sobre los bytes, no sobre el texto decodificado', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"Monto":1}')]);
    const firmaDeLosBytes = createHmac('sha256', SECRETO).update(bytes).digest('hex');
    expect(firmaValida(firmaDeLosBytes, bytes, SECRETO)).toBe(true);
    // El texto decodificado pierde el BOM: firmarlo daría otra cosa.
    const decodificado = new TextDecoder().decode(bytes);
    expect(firmaValida(firmaDeLosBytes, decodificado, SECRETO)).toBe(false);
  });

  it('rechaza una firma de otro cuerpo o de otro secreto', () => {
    const firma = firmaHmac('a', SECRETO);
    expect(firmaValida(firma, 'b', SECRETO)).toBe(false);
    expect(firmaValida(firma, 'a', 'otro-secreto')).toBe(false);
  });

  it('acepta el hexadecimal en mayúsculas y con espacios alrededor', () => {
    const firma = firmaHmac('a', SECRETO);
    expect(firmaValida(firma.toUpperCase(), 'a', SECRETO)).toBe(true);
    expect(firmaValida(`  ${firma}  `, 'a', SECRETO)).toBe(true);
  });

  it('una firma ausente, vacía o de otro largo es inválida y NO lanza', () => {
    expect(firmaValida(null, 'a', SECRETO)).toBe(false);
    expect(firmaValida(undefined, 'a', SECRETO)).toBe(false);
    expect(firmaValida('', 'a', SECRETO)).toBe(false);
    expect(firmaValida('abc', 'a', SECRETO)).toBe(false);
    expect(firmaValida(`${firmaHmac('a', SECRETO)}00`, 'a', SECRETO)).toBe(false);
  });
});

describe('hash del redirect de un enlace de pago', () => {
  const p = {
    identificadorEnlaceComercio: '0b7e5a2c-1111-4222-8333-444455556666',
    idTransaccion: 'd0efabed-12e0-4915-abc1-0d3689906700',
    idEnlace: '1384854',
    monto: '10',
  };

  it('concatena en el orden de la doc: identificador, transacción, enlace, monto', () => {
    expect(textoHashRedirect(p)).toBe('0b7e5a2c-1111-4222-8333-444455556666d0efabed-12e0-4915-abc1-0d36899067001384854' + '10');
    const hash = createHmac('sha256', SECRETO).update(textoHashRedirect(p)).digest('hex');
    expect(hashRedirectValido({ ...p, hash }, SECRETO)).toBe(true);
  });

  it('con otro orden el hash no coincide', () => {
    const otroOrden = createHmac('sha256', SECRETO)
      .update(p.identificadorEnlaceComercio + p.idEnlace + p.idTransaccion + p.monto)
      .digest('hex');
    expect(hashRedirectValido({ ...p, hash: otroOrden }, SECRETO)).toBe(false);
  });

  it('el monto va como llegó: "10" no es "10.00"', () => {
    const hash = createHmac('sha256', SECRETO).update(textoHashRedirect(p)).digest('hex');
    expect(hashRedirectValido({ ...p, monto: '10.00', hash }, SECRETO)).toBe(false);
  });

  it('sin hash es inválido', () => {
    expect(hashRedirectValido({ ...p, hash: null }, SECRETO)).toBe(false);
  });
});
