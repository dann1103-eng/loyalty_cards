import { describe, it, expect } from 'vitest';
import { crearClienteWompi, cuerpoEnlace, ErrorWompi, type DatosEnlace } from './cliente';
import type { ConfigWompi } from './config';

// Sin red: `fetch` y el reloj se inyectan.
//
// MUTATION-TESTING (cada fila se corrió):
//   - no cachear el token                                   → falla "reusa el token mientras no venza"
//   - no renovar el token vencido                           → falla "renueva el token cuando vence"
//   - no reintentar tras un 401                             → fallan "un 401 renueva el token y reintenta UNA vez" y "un segundo 401…"
//   - reintentar más de una vez                             → falla "un segundo 401 no entra en un ciclo" (cuenta las llamadas)
//   - permitir más de un pago por enlace                    → falla "el cuerpo del enlace…"
//   - dejar el monto editable                               → falla "el cuerpo del enlace…"
//   - aceptar una URL http del enlace                       → falla "rechaza un enlace que no es https"
//   - mandar las credenciales del negocio en otro formato   → falla "pide el token con client_credentials…"

const CONFIG: ConfigWompi = {
  clientId: 'id-de-prueba',
  clientSecret: 'secreto-de-prueba',
  urlApi: 'https://api.ejemplo.test',
  urlId: 'https://id.ejemplo.test',
  aceptarPruebas: false,
};

interface Llamada {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

// Un fetch falso que responde en orden y anota cada llamada.
function fetchFalso(respuestas: Array<{ status: number; json?: unknown }>) {
  const llamadas: Llamada[] = [];
  let i = 0;
  const falso = (async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
  return { falso, llamadas };
}

const TOKEN = { status: 200, json: { access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' } };

const DATOS: DatosEnlace = {
  identificador: '0b7e5a2c-1111-4222-8333-444455556666',
  monto: 10.67,
  nombreProducto: 'Cardly SV · Ajuste a Plan Growth',
  descripcion: 'Starter → Growth, 16 de 30 días',
  urlRedirect: 'https://www.cardly-sv.site/comercio/plan/pago/resultado',
  urlRetorno: 'https://www.cardly-sv.site/comercio/plan',
  urlWebhook: 'https://www.cardly-sv.site/api/wompi/webhook',
  ahora: new Date('2026-09-15T18:00:00.000Z'),
  venceEn: new Date('2026-09-15T20:00:00.000Z'),
  datosAdicionales: { cobro: '0b7e5a2c-1111-4222-8333-444455556666' },
};

describe('cuerpoEnlace', () => {
  it('el cuerpo del enlace: un solo pago, monto y cantidad fijos, solo tarjeta, con vigencia', () => {
    expect(cuerpoEnlace(DATOS)).toEqual({
      identificadorEnlaceComercio: DATOS.identificador,
      monto: 10.67,
      nombreProducto: 'Cardly SV · Ajuste a Plan Growth',
      formaPago: {
        permitirTarjetaCreditoDebido: true,
        permitirPagoConPuntoAgricola: false,
        permitirPagoEnCuotasAgricola: false,
        permitirPagoEnBitcoin: false,
        permitePagoQuickPay: false,
        permitePagoNequi: false,
      },
      infoProducto: { descripcionProducto: 'Starter → Growth, 16 de 30 días' },
      configuracion: {
        urlRedirect: DATOS.urlRedirect,
        esMontoEditable: false,
        esCantidadEditable: false,
        cantidadPorDefecto: 1,
        duracionInterfazIntentoMinutos: 60,
        urlRetorno: DATOS.urlRetorno,
        urlWebhook: DATOS.urlWebhook,
        notificarTransaccionCliente: true,
      },
      vigencia: { fechaInicio: '2026-09-15T18:00:00.000Z', fechaFin: '2026-09-15T20:00:00.000Z' },
      limitesDeUso: { cantidadMaximaPagosExitosos: 1 },
      datosAdicionales: { cobro: DATOS.identificador },
    });
  });
});

describe('autenticación', () => {
  it('pide el token con client_credentials, el audience de Wompi y las credenciales del negocio', async () => {
    const { falso, llamadas } = fetchFalso([TOKEN, { status: 200, json: { nombre: 'Cardly SV', estaProductivo: false } }]);
    await crearClienteWompi(CONFIG, { fetch: falso }).datosDelNegocio();

    expect(llamadas[0]).toMatchObject({ url: 'https://id.ejemplo.test/connect/token', method: 'POST' });
    expect(llamadas[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(llamadas[0].body);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'client_credentials',
      audience: 'wompi_api',
      client_id: 'id-de-prueba',
      client_secret: 'secreto-de-prueba',
    });
    expect(llamadas[1].headers.authorization).toBe('Bearer tok-1');
  });

  it('reusa el token mientras no venza', async () => {
    const { falso, llamadas } = fetchFalso([TOKEN, { status: 200, json: { estaProductivo: false } }, { status: 200, json: { estaProductivo: false } }]);
    const cliente = crearClienteWompi(CONFIG, { fetch: falso, ahora: () => 1_000 });
    await cliente.datosDelNegocio();
    await cliente.datosDelNegocio();
    expect(llamadas.filter((l) => l.url.endsWith('/connect/token'))).toHaveLength(1);
  });

  it('renueva el token cuando vence (con un minuto de margen)', async () => {
    const tokens = [
      { status: 200, json: { access_token: 'tok-1', expires_in: 3600 } },
      { status: 200, json: { access_token: 'tok-2', expires_in: 3600 } },
    ];
    const { falso, llamadas } = fetchFalso([tokens[0], { status: 200, json: {} }, tokens[1], { status: 200, json: {} }]);
    let ahora = 0;
    const cliente = crearClienteWompi(CONFIG, { fetch: falso, ahora: () => ahora });
    await cliente.datosDelNegocio();
    ahora = (3600 - 60) * 1000 + 1; // pasó el margen
    await cliente.datosDelNegocio();
    expect(llamadas.filter((l) => l.url.endsWith('/connect/token'))).toHaveLength(2);
    expect(llamadas[3].headers.authorization).toBe('Bearer tok-2');
  });

  it('un 401 renueva el token y reintenta UNA vez', async () => {
    const { falso, llamadas } = fetchFalso([
      { status: 200, json: { access_token: 'viejo', expires_in: 3600 } },
      { status: 401 },
      { status: 200, json: { access_token: 'nuevo', expires_in: 3600 } },
      { status: 200, json: { nombre: 'Cardly SV', estaProductivo: false } },
    ]);
    const negocio = await crearClienteWompi(CONFIG, { fetch: falso }).datosDelNegocio();
    expect(negocio).toEqual({ nombre: 'Cardly SV', esProductivo: false });
    expect(llamadas).toHaveLength(4);
    expect(llamadas[3].headers.authorization).toBe('Bearer nuevo');
  });

  it('un segundo 401 no entra en un ciclo: falla con el estado', async () => {
    const { falso, llamadas } = fetchFalso([TOKEN, { status: 401 }, TOKEN, { status: 401 }]);
    await expect(crearClienteWompi(CONFIG, { fetch: falso }).datosDelNegocio()).rejects.toMatchObject({ name: 'ErrorWompi', estado: 401 });
    expect(llamadas).toHaveLength(4);
  });

  it('si Wompi rechaza las credenciales lanza un error SIN el secreto', async () => {
    const { falso } = fetchFalso([{ status: 400, json: { error: 'invalid_client' } }]);
    const error = await crearClienteWompi(CONFIG, { fetch: falso }).datosDelNegocio().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorWompi);
    expect((error as ErrorWompi).estado).toBe(400);
    expect((error as ErrorWompi).message).not.toContain('secreto-de-prueba');
  });

  it('una respuesta de token sin access_token es un error, no un token vacío', async () => {
    const { falso } = fetchFalso([{ status: 200, json: { expires_in: 3600 } }]);
    await expect(crearClienteWompi(CONFIG, { fetch: falso }).datosDelNegocio()).rejects.toThrow('respuesta de autenticación inesperada');
  });
});

describe('crearEnlacePago', () => {
  it('manda el cuerpo del enlace a POST /EnlacePago y devuelve el enlace', async () => {
    const { falso, llamadas } = fetchFalso([
      TOKEN,
      { status: 200, json: { idEnlace: 15, urlEnlace: 'https://lk.wompi.sv/yhDt', urlEnlaceLargo: 'https://lk.wompi.sv/largo', estaProductivo: false } },
    ]);
    const enlace = await crearClienteWompi(CONFIG, { fetch: falso }).crearEnlacePago(DATOS);

    expect(enlace).toEqual({ idEnlace: 15, urlEnlace: 'https://lk.wompi.sv/yhDt', urlEnlaceLargo: 'https://lk.wompi.sv/largo', esProductivo: false });
    expect(llamadas[1]).toMatchObject({ url: 'https://api.ejemplo.test/EnlacePago', method: 'POST' });
    expect(JSON.parse(llamadas[1].body ?? '{}')).toEqual(JSON.parse(JSON.stringify(cuerpoEnlace(DATOS))));
  });

  it('rechaza un enlace que no es https: se usa para redirigir al dueño', async () => {
    const { falso } = fetchFalso([TOKEN, { status: 200, json: { idEnlace: 1, urlEnlace: 'http://lk.wompi.sv/x' } }]);
    await expect(crearClienteWompi(CONFIG, { fetch: falso }).crearEnlacePago(DATOS)).rejects.toThrow('enlace de pago inesperado');
  });

  it('un rechazo de Wompi lanza con el estado y un resumen de lo que dijo', async () => {
    const { falso } = fetchFalso([TOKEN, { status: 400, json: { mensaje: 'monto inválido' } }]);
    const error = await crearClienteWompi(CONFIG, { fetch: falso }).crearEnlacePago(DATOS).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'ErrorWompi', estado: 400 });
    expect((error as ErrorWompi).message).toContain('monto inválido');
  });
});

describe('consultarTransaccion', () => {
  it('normaliza la transacción y escapa el id en la ruta', async () => {
    const { falso, llamadas } = fetchFalso([
      TOKEN,
      {
        status: 200,
        json: {
          idTransaccion: 'tx/1', esReal: true, esAprobada: true, monto: 49, montoOriginal: 49,
          fechaTransaccion: '2026-09-15T18:30:00Z', datosAdicionales: { cobro: 'c1', numero: 5 },
        },
      },
    ]);
    const t = await crearClienteWompi(CONFIG, { fetch: falso }).consultarTransaccion('tx/1');
    expect(t).toEqual({
      idTransaccion: 'tx/1', esReal: true, esAprobada: true, monto: 49,
      fecha: '2026-09-15T18:30:00Z', datosAdicionales: { cobro: 'c1' },
    });
    expect(llamadas[1].url).toBe('https://api.ejemplo.test/TransaccionCompra/tx%2F1');
  });

  it('usa montoOriginal si no viene monto, y un esReal ausente es falso', async () => {
    const { falso } = fetchFalso([TOKEN, { status: 200, json: { idTransaccion: 'tx', montoOriginal: 10 } }]);
    expect(await crearClienteWompi(CONFIG, { fetch: falso }).consultarTransaccion('tx')).toMatchObject({ monto: 10, esReal: false, esAprobada: false, datosAdicionales: null });
  });

  it('un 404 lanza un ErrorWompi con estado 404: la página de vuelta lo lee como "todavía no"', async () => {
    const { falso } = fetchFalso([TOKEN, { status: 404 }]);
    await expect(crearClienteWompi(CONFIG, { fetch: falso }).consultarTransaccion('nada')).rejects.toMatchObject({ estado: 404 });
  });
});
