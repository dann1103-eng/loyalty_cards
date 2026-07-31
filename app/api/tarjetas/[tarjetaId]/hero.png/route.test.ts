import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '../../../../../test/fixtures/entornoComercio';

// LA prueba que separa "la URL cambió" de "la imagen cambió".
//
// Esta ruta DIBUJA la grilla de sellos que Google usa como heroImage. Su modo de falla es el peor
// del sistema: silencioso y con apariencia de éxito. `versionHero` (lib/google/heroUrl.ts) hashea
// el branding para el cache-busting del `?v=`; si el hash pasa a usar el branding EFECTIVO del
// programa pero esta ruta sigue leyendo `comercios`, la URL cambia, Google re-descarga con
// entusiasmo… y recibe exactamente la misma imagen mal dibujada. Ni un error en los logs.
//
// Se mockea componerStrips y se aserta sobre sus ARGUMENTOS: comparar bytes de PNG no diría nada
// útil cuando falle, y lo que importa es qué branding se le pidió dibujar.
const componerStripsMock = vi.fn();

vi.mock('@/lib/apple/stripPass', () => ({
  componerStrips: (...args: unknown[]) => componerStripsMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  // Devuelve algo con forma de strips para que la ruta no corte antes de tiempo; el contenido no
  // importa, la aserción es sobre lo que RECIBIÓ.
  componerStripsMock.mockReset().mockResolvedValue({ x1: Buffer.from('a'), x2: Buffer.from('b'), x3: Buffer.from('c') });
});

afterEach(() => entorno.limpiar());

async function pedirImagen(tarjetaId: string) {
  const { GET } = await import('./route');
  return GET(new Request('http://localhost/x') as never, { params: Promise.resolve({ tarjetaId }) });
}

describe('GET /api/tarjetas/[tarjetaId]/hero.png', () => {
  it('dibuja con el branding EFECTIVO del programa, no con el del comercio', async () => {
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'sellos',
      sello_meta: 8,
      sello_icono_url: 'https://ejemplo.com/sello-COMERCIO.png',
      color_fondo: 'rgb(10, 10, 10)',
    });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase
      .from('programas_tarjeta')
      .update({
        branding_propio: true,
        sello_icono_url: 'https://ejemplo.com/sello-PROGRAMA.png',
      })
      .eq('id', programaId);
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId, 3);

    await pedirImagen(tarjetaId);

    expect(componerStripsMock).toHaveBeenCalledOnce();
    const args = componerStripsMock.mock.calls[0][0];
    expect(args.selloIconoUrl, 'el ícono tiene que ser el del PROGRAMA').toBe(
      'https://ejemplo.com/sello-PROGRAMA.png',
    );
    // …y lo que el programa NO define se sigue heredando, en la misma llamada.
    expect(args.colorFondo, 'lo no definido se hereda del comercio').toBe('rgb(10, 10, 10)');
  }, 30_000);

  it('sin branding propio, dibuja con el del comercio', async () => {
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'sellos',
      sello_meta: 8,
      sello_icono_url: 'https://ejemplo.com/sello-COMERCIO.png',
    });
    const { id: tarjetaId } = await entorno.crearTarjeta(comercioId, 3);

    await pedirImagen(tarjetaId);

    const args = componerStripsMock.mock.calls[0][0];
    expect(args.selloIconoUrl).toBe('https://ejemplo.com/sello-COMERCIO.png');
  }, 30_000);
});
