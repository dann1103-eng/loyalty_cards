import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { guardarReverso, validarUrlHttps, type DatosReversoComercio } from './guardarReverso';

const supabase = createServiceClient();
const idsDePrueba: string[] = [];

afterEach(async () => {
  if (!idsDePrueba.length) return;
  const { error } = await supabase.from('comercios').delete().in('id', idsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los comercios de prueba:', error);
  idsDePrueba.length = 0;
});

async function crearComercio(): Promise<string> {
  const slug = `test-reverso-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Reverso', slug, tipo_tarjeta: 'sellos' })
    .select('id')
    .single();
  if (error) throw error;
  idsDePrueba.push(data.id);
  return data.id;
}

// Todos los campos vacíos: cada prueba llena SOLO el que le interesa, así lo único que puede
// hacer fallar la validación es el caso bajo prueba y no un vecino mal armado.
function datosVacios(): DatosReversoComercio {
  return {
    terminos_uso: '',
    red_instagram: '',
    red_facebook: '',
    red_whatsapp: '',
    sitio_web: '',
    mostrar_como_funciona: true,
  };
}

describe('validarUrlHttps', () => {
  it('acepta una https válida', () => {
    expect(validarUrlHttps('https://instagram.com/fm')).toBe(true);
    expect(validarUrlHttps('https://wa.me/50370000000')).toBe(true);
  });

  it('rechaza lo que no empieza con https:// — la mitad startsWith del validador', () => {
    // Esta línea NO es decorativa: documenta de forma ejecutable POR QUÉ el startsWith tiene que
    // existir. El parser WHATWG borra los saltos de línea ANTES de parsear, así que mirar solo el
    // protocolo daría por buena una cadena que, guardada cruda, no empieza con https://.
    expect(new URL('ht\ntps://ejemplo.com').protocol).toBe('https:');

    expect(validarUrlHttps('ht\ntps://ejemplo.com')).toBe(false);
    expect(validarUrlHttps('http://ejemplo.com')).toBe(false);
    expect(validarUrlHttps('javascript:alert(1)')).toBe(false);
  });

  it('rechaza lo que empieza bien pero no parsea — la mitad new URL() del validador', () => {
    // Los dos PASAN el startsWith y revientan con TypeError en new URL(). Son los únicos casos de
    // la suite que dependen de esa mitad: sin ellos, borrar el new URL() deja todo verde.
    expect(validarUrlHttps('https://')).toBe(false);
    expect(validarUrlHttps('https://[bad')).toBe(false);
  });
});

describe('guardarReverso', () => {
  it('guarda términos, las cuatro URLs y el interruptor', async () => {
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      terminos_uso: 'Los sellos no vencen.',
      red_instagram: 'https://instagram.com/fm',
      red_facebook: 'https://facebook.com/fm',
      red_whatsapp: 'https://wa.me/50370000000',
      sitio_web: 'https://fm.example',
      mostrar_como_funciona: false,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web, mostrar_como_funciona')
      .eq('id', id)
      .single();
    expect(data!.terminos_uso).toBe('Los sellos no vencen.');
    expect(data!.red_instagram).toBe('https://instagram.com/fm');
    expect(data!.red_facebook).toBe('https://facebook.com/fm');
    expect(data!.red_whatsapp).toBe('https://wa.me/50370000000');
    expect(data!.sitio_web).toBe('https://fm.example');
    // El false tiene que sobrevivir: el default de la columna es true, así que olvidar el campo en
    // el update (o un `|| true`) se vería como éxito y dejaría la sección encendida igual.
    expect(data!.mostrar_como_funciona).toBe(false);
  });

  it('rechaza una URL http:// nombrando la red, y no escribe nada', async () => {
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      ...datosVacios(),
      red_instagram: 'http://ejemplo.com',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/instagram/i);
    // El rechazo tiene que ser ANTES del update: si validara después, el valor malo ya estaría
    // en la tarjeta de cada cliente aunque el dueño viera un error.
    const { data } = await supabase.from('comercios').select('red_instagram').eq('id', id).single();
    expect(data!.red_instagram).toBeNull();
  });

  it('rechaza javascript: aunque el navegador lo parsee como URL', async () => {
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      ...datosVacios(),
      red_facebook: 'javascript:alert(1)',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/facebook/i);
  });

  it('rechaza una URL con un salto de línea dentro del esquema', async () => {
    // El caso que motivó el doble chequeo: new URL('ht\ntps://…') devuelve protocol 'https:'
    // (comprobado en el Node de este proyecto), así que solo el startsWith lo atrapa. Como se
    // guarda la cadena CRUDA, sin él esto terminaría en el href del pass sin empezar con https://.
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      ...datosVacios(),
      sitio_web: 'ht\ntps://ejemplo.com',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sitio web/i);
    const { data } = await supabase.from('comercios').select('sitio_web').eq('id', id).single();
    expect(data!.sitio_web).toBeNull();
  });

  it('rechaza "https://" a secas y "https://[bad", que pasan el startsWith', async () => {
    // La otra mitad del validador: los dos revientan en new URL(). Sin este caso, "simplificar"
    // validarUrlHttps a solo el startsWith deja la suite entera en verde.
    const id = await crearComercio();

    const soloEsquema = await guardarReverso(supabase, id, { ...datosVacios(), red_whatsapp: 'https://' });
    expect(soloEsquema.ok).toBe(false);
    if (!soloEsquema.ok) expect(soloEsquema.error).toMatch(/whatsapp/i);

    const corchete = await guardarReverso(supabase, id, { ...datosVacios(), sitio_web: 'https://[bad' });
    expect(corchete.ok).toBe(false);
    if (!corchete.ok) expect(corchete.error).toMatch(/sitio web/i);
  });

  it('rechaza términos de 2001 caracteres y dice el largo que tienen', async () => {
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      ...datosVacios(),
      terminos_uso: 'a'.repeat(2001),
    });

    expect(res.ok).toBe(false);
    // El largo actual en el mensaje: "es muy largo" a secas no le dice al dueño cuánto recortar.
    if (!res.ok) expect(res.error).toMatch(/2001/);
  });

  it('acepta términos de exactamente 2000 caracteres', async () => {
    // El borde: con >= en vez de > el tope real se correría a 1999 y nadie se enteraría.
    const id = await crearComercio();
    const terminos = 'a'.repeat(2000);
    const res = await guardarReverso(supabase, id, { ...datosVacios(), terminos_uso: terminos });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('terminos_uso').eq('id', id).single();
    expect(data!.terminos_uso).toBe(terminos);
  });

  it('rechaza una URL de 501 caracteres y acepta la de 500', async () => {
    const id = await crearComercio();
    const base = 'https://ejemplo.com/';
    const deMas = base + 'a'.repeat(501 - base.length);
    const alBorde = base + 'a'.repeat(500 - base.length);

    const res = await guardarReverso(supabase, id, { ...datosVacios(), sitio_web: deMas });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/501/);

    // El borde de arriba, para que el tope no se pueda correr a 499 sin que la suite se entere.
    const borde = await guardarReverso(supabase, id, { ...datosVacios(), sitio_web: alBorde });
    expect(borde.ok).toBe(true);
  });

  it('guarda como null lo vacío y lo que es solo espacios, nunca cadena vacía', async () => {
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      terminos_uso: '   ',
      red_instagram: '',
      red_facebook: '\n\t ',
      red_whatsapp: '',
      sitio_web: '  ',
      mostrar_como_funciona: true,
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase
      .from('comercios')
      .select('terminos_uso, red_instagram, red_facebook, red_whatsapp, sitio_web')
      .eq('id', id)
      .single();
    // toBeNull y no una comparación floja: con '' el armado del reverso tendría dos casos que
    // mirar por campo, y una fila vacía en la tarjeta del cliente es lo que se escapa.
    expect(data!.terminos_uso).toBeNull();
    expect(data!.red_instagram).toBeNull();
    expect(data!.red_facebook).toBeNull();
    expect(data!.red_whatsapp).toBeNull();
    expect(data!.sitio_web).toBeNull();
  });

  it('guarda la URL cruda, sin normalizarla a la forma de new URL().href', async () => {
    const id = await crearComercio();
    const cruda = 'https://ejemplo.com/a b';
    const res = await guardarReverso(supabase, id, { ...datosVacios(), sitio_web: cruda });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('sitio_web').eq('id', id).single();
    // new URL(cruda).href sería 'https://ejemplo.com/a%20b': devolverle al dueño algo distinto de
    // lo que escribió es desconcertante, y la defensa contra comillas es el escape del render.
    expect(data!.sitio_web).toBe(cruda);
    expect(data!.sitio_web).not.toContain('%20');
  });

  it('recorta los espacios de alrededor antes de validar y de guardar', async () => {
    // Sin el trim, '  https://…  ' no pasa el startsWith y el dueño ve un error por un espacio
    // que él no ve.
    const id = await crearComercio();
    const res = await guardarReverso(supabase, id, {
      ...datosVacios(),
      red_instagram: '  https://instagram.com/fm  ',
    });

    expect(res.ok).toBe(true);
    const { data } = await supabase.from('comercios').select('red_instagram').eq('id', id).single();
    expect(data!.red_instagram).toBe('https://instagram.com/fm');
  });

  it('falla si el comercio ya no existe, en vez de reportar éxito', async () => {
    // Sin el .select('id').single(), un update de 0 filas devolvería ok:true habiendo escrito cero.
    const res = await guardarReverso(supabase, '00000000-0000-0000-0000-000000000000', datosVacios());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no existe/i);
  });
});
