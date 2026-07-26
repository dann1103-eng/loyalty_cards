import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { slugificarNombre, generarSlugUnico } from './slugComercio';

describe('slugificarNombre (pura)', () => {
  it('minúsculas, sin acentos ni ñ, espacios y símbolos a guiones', () => {
    expect(slugificarNombre('Café París 2')).toBe('cafe-paris-2');
    expect(slugificarNombre('La Ñoña')).toBe('la-nona');
    expect(slugificarNombre('  Verde—Raíz  ')).toBe('verde-raiz');
    expect(slugificarNombre('ya-en-forma')).toBe('ya-en-forma');
  });

  it('un nombre sin caracteres usables cae al fallback', () => {
    expect(slugificarNombre('¡¡¡***!!!')).toBe('comercio');
  });
});

describe('generarSlugUnico (integración)', () => {
  const supabase = createServiceClient();
  const comerciosDePrueba: string[] = [];

  afterEach(async () => {
    if (comerciosDePrueba.length) {
      // sucursales apunta a comercios sin cascade: van primero. Los errores se LOGUEAN en vez de
      // descartarse — esta es la BD real donde el usuario hace QA, y una limpieza que falla en
      // silencio deja basura que recién se nota cuando otra corrida choca contra ella.
      const { error: eSucursales } = await supabase
        .from('sucursales').delete().in('comercio_id', comerciosDePrueba);
      if (eSucursales) console.error('[test] no se pudieron borrar las sucursales de prueba:', eSucursales);
      const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
      if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
      comerciosDePrueba.length = 0;
    }
  });

  // Además del reloj, aleatoriedad: dos corridas dentro del mismo milisegundo generarían el mismo
  // base y la segunda chocaría contra el unique de slug (flake no determinista).
  const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  async function ocuparSlug(slug: string) {
    const { data, error } = await supabase
      .from('comercios').insert({ nombre: 'Ocupa', slug }).select('id').single();
    if (error) throw error;
    comerciosDePrueba.push(data.id);
  }

  it('slug libre: devuelve el base', async () => {
    const base = `libre-${sufijo()}`;
    expect(await generarSlugUnico(supabase, base)).toEqual({ ok: true, slug: base });
  });

  it('base ocupado: desambigua con -2', async () => {
    const base = `choca-${sufijo()}`;
    await ocuparSlug(base);
    expect(await generarSlugUnico(supabase, base)).toEqual({ ok: true, slug: `${base}-2` });
  });

  it('con 4 candidatos ocupados todavía alcanza el quinto', async () => {
    // Fija el tope POR ABAJO, y es la ÚNICA prueba que lo hace: la de "los 5 ocupados" llena
    // TODOS los candidatos, así que no distingue "probó 5" de "probó 2" —ambas terminan en el
    // mismo error— y sigue verde con el tope recortado a 4. Acá el quinto es el único libre, así
    // que recortar el tope se detecta.
    const base = `tope-${sufijo()}`;
    await ocuparSlug(base);
    for (let i = 2; i <= 4; i++) await ocuparSlug(`${base}-${i}`);
    expect(await generarSlugUnico(supabase, base)).toEqual({ ok: true, slug: `${base}-5` });
  });

  it('los 5 candidatos ocupados: error claro, sin loop infinito', async () => {
    const base = `lleno-${sufijo()}`;
    await ocuparSlug(base);
    for (let i = 2; i <= 5; i++) await ocuparSlug(`${base}-${i}`);
    expect(await generarSlugUnico(supabase, base)).toEqual({
      ok: false,
      error: 'No se pudo generar una dirección única, cambiá el nombre.',
    });
  });
});
