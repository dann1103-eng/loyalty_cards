import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { guardarFotoRecompensa } from './recompensas';
import { rutaImagenRecompensa } from './imagenComercio';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

async function fotoDe(recompensaId: string): Promise<string | null> {
  const { data } = await supabase
    .from('recompensas')
    .select('foto_url')
    .eq('id', recompensaId)
    .single();
  return data!.foto_url;
}

describe('guardarFotoRecompensa', () => {
  it('guarda y quita la URL de la foto', async () => {
    // La columna foto_url existe desde la migración 0001 y estuvo MUERTA hasta ahora: el spec del
    // MVP la contemplaba y nunca se cableó. Esta prueba es lo que fija que ya no lo esté.
    const comercioId = await entorno.crearComercio();
    const recompensaId = await entorno.crearRecompensa(comercioId, 5);

    expect(await fotoDe(recompensaId)).toBeNull();

    const puesta = await guardarFotoRecompensa(supabase, comercioId, recompensaId, 'https://x/y.png?v=1');
    expect(puesta.ok).toBe(true);
    expect(await fotoDe(recompensaId)).toBe('https://x/y.png?v=1');

    const quitada = await guardarFotoRecompensa(supabase, comercioId, recompensaId, null);
    expect(quitada.ok).toBe(true);
    expect(await fotoDe(recompensaId)).toBeNull();
  });

  it('NO toca la foto de una recompensa de OTRO comercio', async () => {
    // Sin el .eq('comercio_id', …) del update, conocer el id de una recompensa ajena bastaría para
    // cambiarle la imagen que ven sus clientes.
    const comercioA = await entorno.crearComercio();
    const comercioB = await entorno.crearComercio();
    const recompensaId = await entorno.crearRecompensa(comercioA, 5);
    await guardarFotoRecompensa(supabase, comercioA, recompensaId, 'https://propia/a.png');

    const intruso = await guardarFotoRecompensa(supabase, comercioB, recompensaId, 'https://ajena/b.png');

    // El update no matchea ninguna fila: no es un error de BD, simplemente no cambia nada. Lo que
    // importa es que la foto original quede intacta.
    expect(intruso.ok).toBe(true);
    expect(await fotoDe(recompensaId)).toBe('https://propia/a.png');
  });
});

describe('rutaImagenRecompensa', () => {
  it('separa cada premio por su id dentro de la carpeta del comercio', () => {
    // Sin el recompensaId en la ruta, todos los premios de un comercio se pisarían entre sí — que
    // es la diferencia con rutaImagenComercio, donde hay UNA imagen por campo.
    expect(rutaImagenRecompensa('com-1', 'rec-1', 'png')).toBe('com-1/recompensas/rec-1.png');
    expect(rutaImagenRecompensa('com-1', 'rec-2', 'jpg')).toBe('com-1/recompensas/rec-2.jpg');
  });
});
