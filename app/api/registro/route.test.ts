import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '../../../test/fixtures/entornoComercio';
import { guardarBranding } from '@/lib/comercio/guardarBranding';
import { acreditarPuntos } from '@/lib/comercio/acreditar';

// Las dos billeteras de Google se reemplazan: la ruta las llama best-effort después de registrar, y
// esta prueba mide lo que le responde al navegador, no lo que le manda a Google. Con el mock no hay
// forma de que una corrida toque al emisor real (las clases de Google no se pueden borrar).
vi.mock('@/lib/google/syncClase', () => ({
  syncClaseComercio: async () => ({ ok: false, error: 'Google deshabilitado en la prueba.' }),
}));
vi.mock('@/lib/google/syncObjeto', () => ({
  syncObjetoTarjeta: async () => ({ ok: false, error: 'Google deshabilitado en la prueba.' }),
}));

// POST /api/registro: el JSON que recibe la página de registro. `sellosRegalo` es lo que decide la
// frase del regalo de "Tu tarjeta está lista" (solo si llegó), así que tiene que viajar en la respuesta
// y valer 0 para quien ya tenía la tarjeta. `puntosActuales` es el saldo REAL de la tarjeta, lo que
// dibuja la muestra: tiene que ser el regalo en una tarjeta nueva y lo que la tarjeta tiene hoy en una
// que ya existía (donde `sellosRegalo` es 0 y el saldo no).
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una corrida y restaurada con `git checkout -- <archivo>`:
//   - route.ts: sacar `sellosRegalo` del JSON hace fallar la prueba con "cliente nuevo: llega con el
//     regalo puesto: expected undefined to be 2".
//   - route.ts: `sellosRegalo: 2` fijo hace fallar la misma prueba en la segunda llamada, con
//     "cliente que vuelve: no recibe nada: expected 2 to be +0".
//   - route.ts, `puntosActuales` (confirmadas 2026-10-28, cada una restaurada): sacarlo del JSON falla con
//     "cliente nuevo: su saldo es el regalo: expected undefined to be 2"; `puntosActuales: 0` fijo, con
//     "cliente nuevo: su saldo es el regalo: expected +0 to be 2"; y devolver `resultado.sellosRegalo`
//     en su lugar, con "cliente que vuelve: el saldo real de su tarjeta: expected +0 to be 3".
const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

function pedir(cuerpo: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/registro', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
}

describe('POST /api/registro: sellosRegalo', () => {
  it('devuelve los sellos con los que nació la tarjeta, y 0 al volver a registrarse', async () => {
    // Un comercio de sellos con meta 10 y regalo 2, cargados por el camino de producción.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const guardado = await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 10,
      sellos_regalo: 2,
      difuminado_franja: 'medio',
      nombre_pase: null,
      encuadre_franja: { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 },
      oscurecer_franja: true,
    });
    expect(guardado.ok, guardado.ok ? '' : guardado.error).toBe(true);
    const { data: comercio } = await supabase.from('comercios').select('slug').eq('id', comercioId).single();

    const telefono = `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')}`;
    const cuerpo = { comercioSlug: comercio!.slug, nombre: 'Ana', apellido: 'Rivera', telefono };

    const primera = await POST(pedir(cuerpo));
    expect(primera.status).toBe(200);
    const jsonPrimera = await primera.json();
    expect(jsonPrimera.sellosRegalo, 'cliente nuevo: llega con el regalo puesto').toBe(2);
    expect(jsonPrimera.puntosActuales, 'cliente nuevo: su saldo es el regalo').toBe(2);

    // Le acreditan 1 sello: su tarjeta ahora vale 3, y el cliente vuelve a escanear el QR.
    const acreditacion = await acreditarPuntos(supabase, comercioId, jsonPrimera.tarjetaId, 1);
    expect(acreditacion.ok, acreditacion.ok ? '' : acreditacion.error).toBe(true);

    const segunda = await POST(pedir(cuerpo));
    expect(segunda.status).toBe(200);
    const jsonSegunda = await segunda.json();
    expect(jsonSegunda.tarjetaId).toBe(jsonPrimera.tarjetaId);
    // 0 y no 2: ya tenía la tarjeta, la pantalla no puede decirle que acaba de recibir sellos.
    expect(jsonSegunda.sellosRegalo, 'cliente que vuelve: no recibe nada').toBe(0);
    // Pero su tarjeta vale 3: la muestra de "Tu tarjeta está lista" dibuja ESTE número, no el regalo.
    expect(jsonSegunda.puntosActuales, 'cliente que vuelve: el saldo real de su tarjeta').toBe(3);
  });
});
