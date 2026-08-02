import { describe, it, expect } from 'vitest';
import { TIPOS } from '@/lib/tarjetas/tipos';
import { ctaSugerido, CTA_POR_TIPO, CTA_GENERICO } from './ctaSugerido';

describe('ctaSugerido', () => {
  // La prueba que sostiene todo el módulo: un tipo nuevo en el catálogo sin frase propia caería en
  // silencio al genérico "¡Escaneá y sumate!", que es exactamente el problema que esto vino a
  // arreglar — el cartel volvería a no decir qué gana el cliente, sin que nada fallara.
  it('los OCHO tipos del catálogo tienen su propia frase', () => {
    for (const tipo of TIPOS) {
      expect(CTA_POR_TIPO[tipo.valor], `el tipo "${tipo.valor}" no tiene frase sugerida`).toBeTruthy();
      expect(ctaSugerido(tipo.valor)).not.toBe(CTA_GENERICO);
    }
  });

  it('cada tipo propone algo distinto: la frase habla de lo que ESA tarjeta hace', () => {
    const frases = TIPOS.map((t) => ctaSugerido(t.valor));
    expect(new Set(frases).size, 'dos tipos comparten la misma frase').toBe(TIPOS.length);
  });

  it('las tres que pidió el dueño, textuales', () => {
    expect(ctaSugerido('sellos')).toBe('Acumulá sellos y ganá');
    expect(ctaSugerido('puntos')).toBe('Acumulá puntos y ganá premios');
    expect(ctaSugerido('cashback')).toBe('Acumulá saldo con tus compras');
  });

  it('cae al genérico si el tipo falta o no se conoce', () => {
    for (const desconocido of [null, undefined, '', 'nft']) {
      expect(ctaSugerido(desconocido)).toBe(CTA_GENERICO);
    }
  });

  // El genérico es también el default de la columna en la 0028: si se cambia acá y allá no, un
  // programa sin fila y uno con fila recién creada mostrarían frases distintas.
  it('CTA_GENERICO sigue siendo el default de la columna en la migración 0028', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const sql = readFileSync(
      path.join(process.cwd(), 'supabase', 'migrations', '0028_disenos_cartel.sql'),
      'utf8',
    );
    expect(sql).toContain(`texto_cta text not null default '${CTA_GENERICO}'`);
  });
});
