import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  VERSION_API_META,
  construirEventoSubscribe,
  enviarSubscribe,
  hashCorreo,
  idEventoSubscribe,
} from './conversionesMeta';

const sha = (texto: string) => createHash('sha256').update(texto).digest('hex');
const AHORA = new Date('2026-09-13T15:00:00Z');
const DATOS = { cobroId: 'cobro-1', monto: 49, correos: ['Duena@Negocio.com '], ahora: AHORA };
const ENTORNO = { token: 'token-secreto', idPixel: '1387090773585494' };

describe('hashCorreo', () => {
  // Meta exige el correo normalizado (sin espacios, en minúsculas) ANTES del SHA-256: el mismo
  // correo con otra capitalización daría otro hash y no coincidiría con nadie.
  it('normaliza y cifra con SHA-256 en hexadecimal', () => {
    expect(hashCorreo('  Duena@Negocio.com ')).toBe(sha('duena@negocio.com'));
  });

  it('un correo vacío no produce hash', () => {
    expect(hashCorreo('   ')).toBeNull();
  });
});

describe('idEventoSubscribe', () => {
  it('es el mismo para el mismo cobro y distinto entre cobros', () => {
    expect(idEventoSubscribe('cobro-1')).toBe(idEventoSubscribe('cobro-1'));
    expect(idEventoSubscribe('cobro-1')).not.toBe(idEventoSubscribe('cobro-2'));
  });

  // El id del cobro es un identificador interno: a Meta viaja cifrado, nunca tal cual.
  it('no deja ver el id del cobro', () => {
    expect(idEventoSubscribe('cobro-1')).not.toContain('cobro-1');
  });
});

describe('construirEventoSubscribe', () => {
  it('arma Subscribe con valor en USD, hora del envío y solo el correo cifrado', () => {
    expect(construirEventoSubscribe(DATOS)).toEqual({
      data: [
        {
          event_name: 'Subscribe',
          event_time: Math.floor(AHORA.getTime() / 1000),
          action_source: 'system_generated',
          event_id: idEventoSubscribe('cobro-1'),
          user_data: { em: [sha('duena@negocio.com')] },
          custom_data: { value: 49, currency: 'USD' },
        },
      ],
    });
  });

  it('manda cada correo distinto una sola vez', () => {
    const cuerpo = construirEventoSubscribe({ ...DATOS, correos: ['a@x.com', 'A@x.com', 'b@x.com'] });
    expect(cuerpo?.data[0].user_data.em).toEqual([sha('a@x.com'), sha('b@x.com')]);
  });

  it('agrega el código de prueba solo si viene', () => {
    expect(construirEventoSubscribe(DATOS, 'TEST123')?.test_event_code).toBe('TEST123');
    expect(construirEventoSubscribe(DATOS)).not.toHaveProperty('test_event_code');
  });

  // Sin correo Meta no puede atribuirlo a nadie, y un cobro en $0 no es un pago.
  it('no arma nada sin correos o con monto que no sea positivo', () => {
    expect(construirEventoSubscribe({ ...DATOS, correos: [] })).toBeNull();
    expect(construirEventoSubscribe({ ...DATOS, correos: ['  '] })).toBeNull();
    expect(construirEventoSubscribe({ ...DATOS, monto: 0 })).toBeNull();
    expect(construirEventoSubscribe({ ...DATOS, monto: Number.NaN })).toBeNull();
  });
});

describe('enviarSubscribe', () => {
  it('sin token o sin píxel no llama a Meta', async () => {
    const fetchFalso = vi.fn();
    expect(await enviarSubscribe(DATOS, { idPixel: ENTORNO.idPixel }, fetchFalso)).toBe('sin-configurar');
    expect(await enviarSubscribe(DATOS, { token: 'x' }, fetchFalso)).toBe('sin-configurar');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sin datos atribuibles no llama a Meta', async () => {
    const fetchFalso = vi.fn();
    expect(await enviarSubscribe({ ...DATOS, correos: [] }, ENTORNO, fetchFalso)).toBe('sin-datos');
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('hace POST al endpoint de eventos del píxel con el cuerpo armado', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));
    expect(await enviarSubscribe(DATOS, { ...ENTORNO, codigoPrueba: 'TEST123' }, fetchFalso)).toBe('enviado');

    const [url, init] = fetchFalso.mock.calls[0];
    expect(url).toBe(
      `https://graph.facebook.com/${VERSION_API_META}/1387090773585494/events?access_token=token-secreto`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual(construirEventoSubscribe(DATOS, 'TEST123'));
  });

  // Medir nunca puede romper el registro del pago: un error de Meta se reporta, no se lanza.
  it('una respuesta de error o una red caída devuelven "error" sin lanzar', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rechazo = vi.fn().mockResolvedValue(new Response('{"error":{}}', { status: 400 }));
    expect(await enviarSubscribe(DATOS, ENTORNO, rechazo)).toBe('error');
    const caida = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await enviarSubscribe(DATOS, ENTORNO, caida)).toBe('error');

    // Y el token no aparece en lo que se escribe al log.
    const logueado = JSON.stringify(errorSpy.mock.calls);
    expect(logueado).not.toContain('token-secreto');
    errorSpy.mockRestore();
  });
});
