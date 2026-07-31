import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enviarMensajeGoogle } from './enviarMensaje';

// NOTA para quien relea el plan (docs/superpowers/specs/2026-07-29-notificaciones-push.md, Task 4):
// el Step 1 del plan describe este archivo como una prueba de integración que llama a Google de
// verdad, "mismo patrón que syncClase.test.ts/syncObjeto.test.ts". Al leer esos dos archivos
// (requisito del propio Step 1) se confirma que NO es así: ambos hacen vi.mock('./walletClient')
// y nunca tocan la red. Seguimos ese patrón real, no la descripción — por dos razones: (1) es la
// convención real y verificada del proyecto para este directorio, y (2) una prueba que de verdad
// llamara a Google necesitaría un google_object_id real, lo que exige un LoyaltyClass real contra
// el emisor de producción — y CLAUDE.md ya deja registrado que esas clases NO se pueden borrar
// (sin `delete` en la API), así que cada corrida de esta suite dejaría basura de QA permanente en
// la cuenta real. Mockear `walletClient` evita ambos problemas.
const addmessageMock = vi.fn();

vi.mock('./walletClient', () => ({
  walletClient: () => ({
    loyaltyobject: { addmessage: addmessageMock },
  }),
}));

beforeEach(() => {
  // La API devuelve el objeto YA ACTUALIZADO en `resource`; de ahí sale hasUsers sin pagar una
  // llamada extra. Por defecto, alguien tiene el pase guardado.
  addmessageMock.mockReset().mockResolvedValue({ data: { resource: { hasUsers: true } } });
});

describe('enviarMensajeGoogle', () => {
  it('manda el mensaje al objeto indicado con messageType TEXT_AND_NOTIFY', async () => {
    const resultado = await enviarMensajeGoogle(
      'issuer-test.tarjeta_x',
      'Cardly SV',
      'Mensaje de prueba automatizada',
    );

    expect(resultado).toEqual({ ok: true, tieneUsuarios: true });
    expect(addmessageMock).toHaveBeenCalledOnce();
    const llamada = addmessageMock.mock.calls[0][0];
    expect(llamada.resourceId).toBe('issuer-test.tarjeta_x');
    // TEXT_AND_NOTIFY y NO 'TEXT': esta es la línea que decide si el cliente ve una notificación o
    // no ve absolutamente nada. 'TEXT' solo escribe el mensaje en el detalle del pase, en silencio
    // — lo confirmó una prueba real de Daniel en su teléfono (2026-07-30), y la documentación de
    // Google lo dice explícitamente: TEXT "renders the message as text on the card details screen",
    // TEXT_AND_NOTIFY "...and as an Android notification".
    expect(llamada.requestBody).toEqual({
      message: {
        header: 'Cardly SV',
        body: 'Mensaje de prueba automatizada',
        messageType: 'TEXT_AND_NOTIFY',
      },
    });
  });

  it('un objectId inexistente (o cualquier fallo de Google) devuelve ok:false, no lanza', async () => {
    addmessageMock.mockRejectedValueOnce(new Error('objeto no encontrado'));

    const resultado = await enviarMensajeGoogle('id-que-no-existe-12345', 'Cardly SV', 'Prueba');

    expect(resultado).toEqual({ ok: false, tieneUsuarios: false });
  });

  // La distinción que motivó todo este retorno: la llamada SALE BIEN pero el mensaje no llega a
  // ningún teléfono, porque el LoyaltyObject existe desde que nosotros lo creamos y nadie lo
  // guardó. En producción, el 2026-07-30, 4 de 6 tarjetas estaban así y el dueño veía "6 alcanzadas".
  it('objeto sin usuarios: ok es true (la API respondió), pero tieneUsuarios es false', async () => {
    addmessageMock.mockResolvedValueOnce({ data: { resource: { hasUsers: false } } });

    const resultado = await enviarMensajeGoogle('issuer-test.nadie_lo_guardo', 'Cardly SV', 'Prueba');

    expect(resultado).toEqual({ ok: true, tieneUsuarios: false });
  });

  it('si Google omite hasUsers, NO se cuenta la tarjeta', async () => {
    // hasUsers es opcional en el tipo (lo pone la plataforma). Ante la duda el número va para
    // abajo: el objetivo de este dato es dejar de inflar lo que ve el dueño.
    addmessageMock.mockResolvedValueOnce({ data: { resource: {} } });

    const resultado = await enviarMensajeGoogle('issuer-test.sin_dato', 'Cardly SV', 'Prueba');

    expect(resultado).toEqual({ ok: true, tieneUsuarios: false });
  });
});
