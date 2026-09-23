import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '@/test/fixtures/entornoComercio';

// Archivo APARTE de reglas/actions.test.ts a propósito, por una razón que sigue vigente aunque la
// migración 0039 ya esté aplicada: ese archivo prueba el sub-bloque de exigir/mínimo (Tarea 4), y
// mezclar esta prueba ahí acoplaría sin necesidad dos features que no comparten nada. La de acá corre
// en VERDE: el camino que ejercita (pedir marcado + link vacío) corta ANTES de tocar la base
// (`guardarResenaGoogle` valida y devuelve el error sin llamar a `supabase.update`, ver
// resenaGoogle.test.ts, describe "corta antes de tocar la base").
//
// Item 7(b) de la revisión de código del commit 455b165: a diferencia de una prueba pura que arma el
// FormData a mano, esta sale del HTML REAL que dibuja FormularioResenaGoogle — así queda fijado el
// PEGAMENTO entre el marcado y la acción: los nombres `pedir_resena_google`/`resena_google_url` y el
// `=== 'on'` con el que accionGuardarResenaGoogle lee la casilla.
//
// MUTACIÓN verificada (2026-09-23, con la 0039 aplicada): cambiar el `name="pedir_resena_google"` del
// checkbox en FormularioResenaGoogle.tsx por otro nombre hace fallar esta prueba — la acción deja de
// ver la casilla marcada, `pedir` queda en `false`, y como `pedir=false` no corta antes de la base,
// termina haciendo un UPDATE de verdad. Con la 0039 aplicada ese UPDATE tiene ÉXITO (pedir:false,
// url:null es una combinación válida), así que la acción devuelve `{ guardado: true }` en vez del
// `{ error: 'Pegá el link…' }` que la prueba espera — sigue fallando, pero por un motivo distinto al
// que valía antes de la migración (antes el UPDATE fallaba por la columna faltante).

const { sesion } = vi.hoisted(() => ({ sesion: { comercioId: '' } }));
vi.mock('@/lib/comercio/verifyComercioOwner', () => ({
  verifyComercioOwner: async () => ({ comercioId: sesion.comercioId }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const { accionGuardarResenaGoogle } = await import('./actions');
const { default: FormularioResenaGoogle } = await import('./FormularioResenaGoogle');

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(() => entorno.limpiar());

// Lo que el navegador enviaría al apretar Guardar — mismo criterio que enviar() en
// reglas/actions.test.ts y en programas/actions.test.ts, acotado a los dos campos de este formulario
// (una casilla y un texto; sin select ni textarea, este formulario no los tiene).
function enviar(html: string, cambios: Record<string, string | false> = {}): FormData {
  const atributos = (etiqueta: string) => {
    const mapa = new Map<string, string>();
    for (const [, nombre, valor] of etiqueta.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      mapa.set(nombre, (valor ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    }
    return mapa;
  };

  const fd = new FormData();
  for (const [bloque] of html.matchAll(/<input\b[^>]*>/g)) {
    const attrs = atributos(bloque.slice(bloque.indexOf(' ')));
    const nombre = attrs.get('name');
    if (!nombre || attrs.has('disabled')) continue;
    const cambio = cambios[nombre];

    if (attrs.get('type') === 'checkbox') {
      const marcada = cambio === undefined ? attrs.has('checked') : cambio !== false;
      if (marcada) fd.append(nombre, attrs.get('value') ?? 'on');
      continue;
    }

    fd.append(nombre, typeof cambio === 'string' ? cambio : (attrs.get('value') ?? ''));
  }
  return fd;
}

function dibujarFormulario(): string {
  return renderToStaticMarkup(
    createElement(FormularioResenaGoogle, { resena: { pedir: false, url: null } }),
  );
}

describe('accionGuardarResenaGoogle', () => {
  it('pedir marcado + link vacío → el error exacto, sin tocar la base', async () => {
    const comercioId = await entorno.crearComercio();
    sesion.comercioId = comercioId;

    const html = dibujarFormulario();
    const res = await accionGuardarResenaGoogle(undefined, enviar(html, { pedir_resena_google: 'on' }));

    expect(res).toEqual({ error: 'Pegá el link para dejar reseña en Google.' });
  });
});
