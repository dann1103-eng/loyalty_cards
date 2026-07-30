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
  addmessageMock.mockReset().mockResolvedValue({});
});

describe('enviarMensajeGoogle', () => {
  it('manda el mensaje al objeto indicado con messageType TEXT y devuelve true', async () => {
    const resultado = await enviarMensajeGoogle(
      'issuer-test.tarjeta_x',
      'Cardly SV',
      'Mensaje de prueba automatizada',
    );

    expect(resultado).toBe(true);
    expect(addmessageMock).toHaveBeenCalledOnce();
    const llamada = addmessageMock.mock.calls[0][0];
    expect(llamada.resourceId).toBe('issuer-test.tarjeta_x');
    // messageType: 'TEXT' es lo que dispara una notificación real en vez de solo quedar en el
    // historial del pase (ver la nota "IMPORTANTE" de la Task 4) — se afirma explícitamente para
    // que una mutación que lo cambie o lo quite haga fallar esta prueba.
    expect(llamada.requestBody).toEqual({
      message: { header: 'Cardly SV', body: 'Mensaje de prueba automatizada', messageType: 'TEXT' },
    });
  });

  it('un objectId inexistente (o cualquier fallo de Google) devuelve false, no lanza', async () => {
    addmessageMock.mockRejectedValueOnce(new Error('objeto no encontrado'));

    const resultado = await enviarMensajeGoogle('id-que-no-existe-12345', 'Cardly SV', 'Prueba');

    expect(resultado).toBe(false);
  });
});
