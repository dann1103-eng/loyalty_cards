import { describe, it, expect } from 'vitest';
import { decodificarCuerpo, estaAprobado, parsearWebhook } from './webhook';

// MUTATION-TESTING (cada fila se corrió):
//   - buscar los campos distinguiendo mayúsculas  → falla "tolera mayúsculas y minúsculas"
//   - asumir EsProductiva=false cuando falta      → falla "sin EsProductiva se rechaza"
//   - tratar una declinada como aprobada          → falla "una declinada no está aprobada"
//   - no quitar el BOM                            → falla "quita el BOM antes de parsear"
//   - exigir Monto numérico (rechazar un texto)   → fallan "tolera mayúsculas y minúsculas…" y "el webhook REAL del 2026-09-21…"

// El ejemplo de la doc de Wompi (2020), tal cual.
const EJEMPLO_DE_LA_DOC = {
  IdCuenta: '980b36e6-15ab-463f-4444-ada3e396fe48',
  FechaTransaccion: '2020-07-07T21:27:03.3403497-06:00',
  Monto: 1,
  ModuloUtilizado: 'BotonPago',
  FormaPagoUtilizada: 'PagoNormal',
  IdTransaccion: '2bedafea-0924-49f0-927d-8c638e193990',
  ResultadoTransaccion: 'ExitosaAprobada',
  CodigoAutorizacion: 'ba7dbfd3-50d1-403c-bbfd-d3be5dc766f8',
  IdIntentoPago: 'c6e10505-cada-4ae7-9892-d8786b7f455f',
  Cantidad: 1,
  EsProductiva: false,
  Aplicativo: { Nombre: 'Sitio Web Bitworks', Url: 'https://www.bitworks.com.sv/', Id: 'd432aef2-3333-4a75-4444-22e20789834a' },
  EnlacePago: { Id: 66, IdentificadorEnlaceComercio: 'OC1234', NombreProducto: 'Camisa Azula' },
  cliente: { Nombre: 'string', Email: 'string' },
};

// El webhook REAL de un pago de prueba en producción (2026-09-21, primer pago con el webhook llegando a
// una URL pública). Difiere del ejemplo de la doc en dos cosas que importan: `Monto` viaja como TEXTO
// ("29.00", no 29), y los datos que la app manda al crear el enlace (`cobro`, `cuenta`) vuelven anidados
// bajo `Cliente`, junto al nombre y el correo de quien pagó — no sueltos como en el ejemplo de 2020. Los
// datos personales de este caso real se reemplazaron por unos genéricos.
const WEBHOOK_REAL_2026_09_21 = {
  Monto: '29.00',
  Cliente: {
    EMail: 'cliente-de-prueba@example.com',
    cobro: 'c9b42d0c-1781-435a-ae4c-01955ec3d104',
    Nombre: 'Cliente De Prueba',
    cuenta: '9776f096-61d5-4d93-b0a9-400ed7cd71b5',
  },
  Tarjeta: '0000 0000 0000 1111 ',
  Cantidad: 1,
  IdCuenta: 'fc30a74f-a249-4504-976e-db69aecb6239',
  IdExterno: 'c9b42d0c-1781-435a-ae4c-01955ec3d104',
  Aplicativo: { Id: '6c0e954b-f846-4fa7-af08-7c7f2cbe2b06', Url: null, Nombre: 'Cardly SV' },
  EnlacePago: {
    Id: 4417925,
    NombreProducto: 'Cardly SV · Plan Starter (2026-09-21 al 2026-10-20)',
    DescripcionProducto: 'Mensualidad del plan Starter',
    IdentificadorEnlaceComercio: 'c9b42d0c-1781-435a-ae4c-01955ec3d104',
  },
  EsProductiva: false,
  IdIntentoPago: 'bb9b1cf0-41b5-4e7a-ac43-fc48a234814e',
  IdTransaccion: '419db111-2cdf-4a6c-a88a-b2ff0c1c4672',
  CantidadCuotas: null,
  EsInternacional: true,
  IdGrupoTarjetas: null,
  ModuloUtilizado: 'BotonPago',
  FechaTransaccion: '2026-09-21T21:24:50.0344235-06:00',
  CodigoAutorizacion: '0683f080-ce4d-495b-a9b4-5c4d47aa7720',
  FormaPagoUtilizada: 'PagoNormal',
  ResultadoTransaccion: 'ExitosaAprobada',
};

describe('parsearWebhook', () => {
  it('lee el ejemplo de la doc', () => {
    expect(parsearWebhook(EJEMPLO_DE_LA_DOC)).toEqual({
      ok: true,
      pago: {
        idTransaccion: '2bedafea-0924-49f0-927d-8c638e193990',
        monto: 1,
        esProductiva: false,
        resultado: 'ExitosaAprobada',
        formaPago: 'PagoNormal',
        fecha: '2020-07-08T03:27:03.340Z',
        identificadorEnlace: 'OC1234',
        idEnlace: 66,
      },
    });
  });

  it('tolera mayúsculas y minúsculas en los nombres', () => {
    const minusculas = {
      idtransaccion: 'tx-1',
      monto: 49,
      esproductiva: true,
      enlacepago: { identificadorenlacecomercio: 'abc' },
    };
    expect(parsearWebhook(minusculas)).toMatchObject({ ok: true, pago: { idTransaccion: 'tx-1', identificadorEnlace: 'abc', esProductiva: true } });
    const camel = { idTransaccion: 'tx-2', monto: '10.5', esProductiva: 'true' };
    expect(parsearWebhook(camel)).toMatchObject({ ok: true, pago: { idTransaccion: 'tx-2', monto: 10.5, esProductiva: true } });
  });

  it('acepta el resultado como número (0 aprobada, 1 declinada, 2 fallida)', () => {
    expect(parsearWebhook({ ...EJEMPLO_DE_LA_DOC, ResultadoTransaccion: 0 })).toMatchObject({ pago: { resultado: 'ExitosaAprobada' } });
    expect(parsearWebhook({ ...EJEMPLO_DE_LA_DOC, ResultadoTransaccion: 1 })).toMatchObject({ pago: { resultado: 'ExitosaDeclinada' } });
    expect(parsearWebhook({ ...EJEMPLO_DE_LA_DOC, ResultadoTransaccion: 2 })).toMatchObject({ pago: { resultado: 'Fallida' } });
  });

  it('un enlace sin identificador, o un cuerpo sin EnlacePago, deja el identificador en null', () => {
    const sinEnlace = { ...EJEMPLO_DE_LA_DOC, EnlacePago: undefined };
    expect(parsearWebhook(sinEnlace)).toMatchObject({ ok: true, pago: { identificadorEnlace: null, idEnlace: null } });
  });

  it('una fecha ilegible queda en null en vez de tumbar el pago', () => {
    expect(parsearWebhook({ ...EJEMPLO_DE_LA_DOC, FechaTransaccion: 'ayer' })).toMatchObject({ ok: true, pago: { fecha: null } });
  });

  it.each([
    ['un texto', 'hola', 'el cuerpo no es un objeto JSON'],
    ['una lista', [], 'el cuerpo no es un objeto JSON'],
    ['null', null, 'el cuerpo no es un objeto JSON'],
    ['sin IdTransaccion', { ...EJEMPLO_DE_LA_DOC, IdTransaccion: '' }, 'falta IdTransaccion'],
    ['sin Monto', { ...EJEMPLO_DE_LA_DOC, Monto: undefined }, 'Monto ausente o inválido'],
    ['con Monto negativo', { ...EJEMPLO_DE_LA_DOC, Monto: -1 }, 'Monto ausente o inválido'],
    ['con Monto no numérico', { ...EJEMPLO_DE_LA_DOC, Monto: 'mucho' }, 'Monto ausente o inválido'],
  ])('rechaza %s', (_nombre, cuerpo, motivo) => {
    expect(parsearWebhook(cuerpo)).toEqual({ ok: false, motivo });
  });

  it('sin EsProductiva se rechaza: no se asume si la plata es real', () => {
    expect(parsearWebhook({ ...EJEMPLO_DE_LA_DOC, EsProductiva: undefined })).toEqual({ ok: false, motivo: 'falta EsProductiva' });
  });

  it('el webhook REAL del 2026-09-21 (Monto como texto, siete decimales en la fecha) se lee entero', () => {
    expect(parsearWebhook(WEBHOOK_REAL_2026_09_21)).toEqual({
      ok: true,
      pago: {
        idTransaccion: '419db111-2cdf-4a6c-a88a-b2ff0c1c4672',
        monto: 29,
        esProductiva: false,
        resultado: 'ExitosaAprobada',
        formaPago: 'PagoNormal',
        fecha: '2026-09-22T03:24:50.034Z',
        identificadorEnlace: 'c9b42d0c-1781-435a-ae4c-01955ec3d104',
        idEnlace: 4417925,
      },
    });
  });
});

describe('estaAprobado', () => {
  const pago = (resultado: string | null) => {
    const r = parsearWebhook({ ...EJEMPLO_DE_LA_DOC, ResultadoTransaccion: resultado ?? undefined });
    if (!r.ok) throw new Error(r.motivo);
    return r.pago;
  };

  it('una aprobada, o un cuerpo sin resultado, se da por aprobado', () => {
    expect(estaAprobado(pago('ExitosaAprobada'))).toBe(true);
    expect(estaAprobado(pago(null))).toBe(true);
  });

  it('una declinada o fallida no está aprobada', () => {
    expect(estaAprobado(pago('ExitosaDeclinada'))).toBe(false);
    expect(estaAprobado(pago('Fallida'))).toBe(false);
  });
});

describe('decodificarCuerpo', () => {
  it('quita el BOM antes de parsear', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"Monto":1}')]);
    expect(decodificarCuerpo(bytes)).toBe('{"Monto":1}');
    expect(JSON.parse(decodificarCuerpo(bytes))).toEqual({ Monto: 1 });
  });

  it('decodifica UTF-8 con tildes', () => {
    expect(decodificarCuerpo(new TextEncoder().encode('{"n":"Pupusería"}'))).toBe('{"n":"Pupusería"}');
  });
});
