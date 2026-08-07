import { describe, it, expect } from 'vitest';
import { TIPOS } from './tipos';
import { unidadPrograma, unidadPara, describirCosto } from './unidadPrograma';

// Cómo se LLAMA lo que cuenta un programa. Existe porque la respuesta estaba escrita dos veces y
// las dos veces mal: `unidad()` en lib/apple/construirReverso.ts y las etiquetas a mano de las
// pantallas del dueño decían "puntos" para TODO lo que no fuera sellos.
//
// Consecuencias reales de eso: un cliente con gift card leía "Ganás 1 punto por cada visita" en el
// reverso de su propia tarjeta, y un dueño de un programa de sellos veía "Costo en puntos" al
// cargar un premio.

describe('unidadPrograma', () => {
  it('cada tipo con contador entero tiene su propia palabra', () => {
    expect(unidadPrograma('puntos')).toEqual({ singular: 'punto', plural: 'puntos' });
    expect(unidadPrograma('sellos')).toEqual({ singular: 'sello', plural: 'sellos' });
    // La razón de ser del módulo: prepago cuenta VISITAS, no puntos.
    expect(unidadPrograma('prepago')).toEqual({ singular: 'visita', plural: 'visitas' });
  });

  it('los tipos cuyo contador es DINERO no tienen unidad contable', () => {
    // Devolver "puntos" acá es exactamente el bug: 2500 centavos son $25.00, no 2500 de nada.
    // null obliga al llamador a formatear con formatearCentavos en vez de inventar una palabra.
    expect(unidadPrograma('gift_card')).toBeNull();
    expect(unidadPrograma('cashback')).toBeNull();
  });

  it('los tipos SIN contador tampoco', () => {
    // Su estado es una fecha o un nivel. "0 puntos" no significa nada para el cliente.
    expect(unidadPrograma('cupon')).toBeNull();
    expect(unidadPrograma('membresia')).toBeNull();
    expect(unidadPrograma('descuento')).toBeNull();
  });

  it('un tipo desconocido se degrada a puntos, no revienta', () => {
    // Misma política que tipoOPuntos: una fila vieja o un valor escrito a mano no debe dejar una
    // pantalla sin dibujar.
    expect(unidadPrograma('lo-que-sea')).toEqual({ singular: 'punto', plural: 'puntos' });
  });

  it('TODO tipo del catálogo tiene una respuesta definida', () => {
    // El candado contra que un tipo nuevo se cuele sin decidir cómo se llama su unidad. Sin esto,
    // el noveno tipo heredaría "puntos" en silencio — que es como nació este bug.
    for (const tipo of TIPOS) {
      const u = unidadPrograma(tipo.valor);
      if (tipo.contador === 'entero') {
        expect(u, `el tipo "${tipo.valor}" cuenta enteros pero no tiene unidad`).not.toBeNull();
        expect(u!.singular.length).toBeGreaterThan(0);
        expect(u!.plural).not.toBe(u!.singular);
      } else {
        expect(u, `el tipo "${tipo.valor}" no cuenta enteros y no debería tener unidad`).toBeNull();
      }
    }
  });
});

describe('unidadPara', () => {
  it('usa el singular SOLO con exactamente uno', () => {
    expect(unidadPara('sellos', 1)).toBe('sello');
    expect(unidadPara('sellos', 2)).toBe('sellos');
    expect(unidadPara('sellos', 0)).toBe('sellos');
    // Una regla puede dar 0.5 puntos por dólar: no es uno, así que es plural.
    expect(unidadPara('puntos', 0.5)).toBe('puntos');
  });

  it('devuelve null donde no hay unidad que nombrar', () => {
    expect(unidadPara('gift_card', 1)).toBeNull();
    expect(unidadPara('cupon', 1)).toBeNull();
  });
});

describe('describirCosto', () => {
  it('cuenta en la unidad del programa', () => {
    expect(describirCosto('sellos', 8)).toBe('8 sellos');
    expect(describirCosto('sellos', 1)).toBe('1 sello');
    expect(describirCosto('prepago', 3)).toBe('3 visitas');
  });

  it('los tipos de dinero se leen en dolares', () => {
    // 250 en la columna son $2.50, no 250 de nada. Es el bug de origen visto desde el otro lado.
    expect(describirCosto('gift_card', 250)).toBe('$2.50');
    expect(describirCosto('cashback', 1250)).toBe('$12.50');
  });

  it('los tipos sin contador no llevan precio', () => {
    // Vacio y no "0": el premio se nombra a secas. Poner un numero seria prometer una moneda que
    // ese programa no tiene.
    expect(describirCosto('cupon', 10)).toBe('');
    expect(describirCosto('membresia', 10)).toBe('');
    expect(describirCosto('descuento', 10)).toBe('');
  });
});
