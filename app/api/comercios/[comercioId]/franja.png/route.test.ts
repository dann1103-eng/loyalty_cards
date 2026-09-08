import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '@/lib/supabase/server';
import { crearEntorno } from '../../../../../test/fixtures/entornoComercio';

// La portada de la LoyaltyClass de Google: la MISMA banda de marca del pass de Apple. Se mockea
// componerFranja y se aserta sobre sus ARGUMENTOS (qué se le pidió dibujar), igual que hero.png.
const componerFranjaMock = vi.fn();
vi.mock('@/lib/apple/stripPass', () => ({
  componerFranja: (...args: unknown[]) => componerFranjaMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  componerFranjaMock.mockReset().mockResolvedValue(Buffer.from('png'));
});
afterEach(() => entorno.limpiar());

async function pedir(comercioId: string, programaId?: string) {
  const { GET } = await import('./route');
  const url = `http://localhost/api/comercios/${comercioId}/franja.png${programaId ? `?programa=${programaId}` : ''}`;
  const { NextRequest } = await import('next/server');
  return GET(new NextRequest(url), { params: Promise.resolve({ comercioId }) });
}

describe('GET /api/comercios/[comercioId]/franja.png', () => {
  it('sin foto efectiva → 404 y no compone nada', async () => {
    const comercioId = await entorno.crearComercio({ hero_url: null });
    const res = await pedir(comercioId);
    expect(res.status).toBe(404);
    expect(componerFranjaMock).not.toHaveBeenCalled();
  }, 30_000);

  it('compone la BANDA (sin grilla, sin franja propia) con el branding y el encuadre del comercio, escala 3', async () => {
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'sellos', sello_meta: 8, hero_url: 'https://ejemplo.com/hero.jpg', strip_url: 'https://ejemplo.com/strip.png',
      color_fondo: 'rgb(10, 10, 10)', foco_franja_y: 0,
    });
    const res = await pedir(comercioId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const [args, escala] = componerFranjaMock.mock.calls[0];
    // MUTACIÓN: pasar el tipo/meta reales dibuja la grilla de UN cliente en la portada de TODOS.
    expect(args.tipoTarjeta).toBe('puntos');
    expect(args.selloMeta).toBeNull();
    expect(args.puntos).toBe(0);
    // MUTACIÓN: pasar marca.stripUrl sirve los bytes crudos de la franja como image/png (decisión 5).
    expect(args.stripUrl).toBeNull();
    expect(args.selloIconoUrl).toBeNull();
    expect(args.heroUrl).toBe('https://ejemplo.com/hero.jpg');
    expect(args.colorFondo).toBe('rgb(10, 10, 10)');
    expect(args.encuadreFranja.focoY).toBe(0);
    expect(escala).toBe(3);
  }, 30_000);

  it('con ?programa= usa el branding efectivo del programa (foto y encuadre propios)', async () => {
    const comercioId = await entorno.crearComercio({ hero_url: 'https://ejemplo.com/hero-COMERCIO.jpg' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    await supabase.from('programas_tarjeta').update({ branding_propio: true, hero_url: 'https://ejemplo.com/hero-PROGRAMA.jpg', encuadre_franja: 'completa', foco_franja_x: 0, foco_franja_y: 0, zoom_franja: 100 }).eq('id', programaId);
    await pedir(comercioId, programaId);
    const [args] = componerFranjaMock.mock.calls[0];
    expect(args.heroUrl).toBe('https://ejemplo.com/hero-PROGRAMA.jpg');
    expect(args.encuadreFranja.modo).toBe('completa');
  }, 30_000);

  it('un ?programa= de OTRO comercio → 404, no cae al comercio en silencio', async () => {
    const comercioId = await entorno.crearComercio({ hero_url: 'https://ejemplo.com/hero.jpg' });
    const otroId = await entorno.crearComercio({ hero_url: 'https://ejemplo.com/otro.jpg' });
    const programaAjeno = entorno.obtenerProgramaPrincipal(otroId);
    const res = await pedir(comercioId, programaAjeno);
    expect(res.status).toBe(404);
    expect(componerFranjaMock).not.toHaveBeenCalled();
  }, 30_000);
});
