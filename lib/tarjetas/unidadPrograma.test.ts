import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TIPOS } from './tipos';
import { unidadPrograma, unidadPara, describirCosto, mensajeAcreditacion } from './unidadPrograma';

// Cómo se LLAMA lo que cuenta un programa. Existe porque la respuesta estaba escrita dos veces y
// las dos veces mal: `unidad()` en lib/apple/construirReverso.ts y las etiquetas a mano de las
// pantallas del dueño decían "puntos" para TODO lo que no fuera sellos.
//
// Consecuencias reales de eso: un cliente con gift card leía "Ganás 1 punto por cada visita" en el
// reverso de su propia tarjeta, y un dueño de un programa de sellos veía "Costo en puntos" al
// cargar un premio.

describe('unidadPrograma', () => {
  it('cada tipo con contador entero tiene su propia palabra', () => {
    expect(unidadPrograma('puntos')).toEqual({ singular: 'punto', plural: 'puntos', articulo: 'Los' });
    expect(unidadPrograma('sellos')).toEqual({ singular: 'sello', plural: 'sellos', articulo: 'Los' });
    // La razón de ser del módulo: prepago cuenta VISITAS, no puntos.
        // 'visitas' es femenino: el articulo viaja con la palabra para que ningun texto escriba 'Los visitas'.
    expect(unidadPrograma('prepago')).toEqual({ singular: 'visita', plural: 'visitas', articulo: 'Las' });
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
    expect(unidadPrograma('lo-que-sea')).toEqual({ singular: 'punto', plural: 'puntos', articulo: 'Los' });
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

// ─────────────────────────────────────────────────────────────────────────────
// El mensaje que lee el CAJERO (2026-09-08)
// ─────────────────────────────────────────────────────────────────────────────
// `'Sello agregado.'` estaba cableado en DOS sitios de escanear/actions.ts: la acreditación normal
// y el switch por tipo. O sea que sumar 1 PUNTO le confirmaba al cajero "Sello agregado", y sumar
// 1 visita a un prepago también. Es el mismo defecto de siempre —una frase que asume sellos— pero
// del lado del mostrador, donde el cajero la usa para saber si hizo lo que quería hacer.
describe('mensajeAcreditacion', () => {
  it('cada tipo con contador se confirma en SU palabra', () => {
    expect(mensajeAcreditacion('sellos', 1)).toBe('Sello agregado.');
    expect(mensajeAcreditacion('puntos', 1)).toBe('Punto agregado.');
    expect(mensajeAcreditacion('sellos', 3)).toBe('3 sellos agregados.');
    expect(mensajeAcreditacion('puntos', 5)).toBe('5 puntos agregados.');
  });

  it('concuerda el género con la unidad, no con "sello"', () => {
    // 'visita' es femenino y el artículo viaja dentro de la Unidad justamente para esto: sin él la
    // frase saldría "Visita agregado".
    expect(mensajeAcreditacion('prepago', 1)).toBe('Visita agregada.');
    expect(mensajeAcreditacion('prepago', 4)).toBe('4 visitas agregadas.');
  });

  it('los tipos de dinero se confirman en dólares', () => {
    // 250 son $2.50. Decirle al cajero "250 puntos agregados" es el bug de origen otra vez.
    expect(mensajeAcreditacion('gift_card', 250)).toBe('$2.50 agregados.');
    expect(mensajeAcreditacion('cashback', 1250)).toBe('$12.50 agregados.');
  });

  it('los tipos sin contador no inventan una moneda', () => {
    expect(mensajeAcreditacion('cupon', 1)).toBe('Listo. Queda registrado.');
    expect(mensajeAcreditacion('membresia', 1)).toBe('Listo. Queda registrado.');
    expect(mensajeAcreditacion('descuento', 1)).toBe('Listo. Queda registrado.');
  });

  // EL guardián: ningún tipo que no sea de sellos puede decir "sello". Un tipo nuevo que herede la
  // frase por descuido rompe acá y no en el mostrador.
  it('solo el programa de sellos habla de sellos', () => {
    for (const tipo of TIPOS) {
      if (tipo.valor === 'sellos') continue;
      for (const cantidad of [1, 3]) {
        expect(
          mensajeAcreditacion(tipo.valor, cantidad).toLowerCase(),
          `el tipo "${tipo.valor}" le confirma sellos al cajero`,
        ).not.toContain('sello');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Que los DOS sitios del escáner de verdad la usen (2026-09-08)
// ─────────────────────────────────────────────────────────────────────────────
// Las pruebas de arriba son de la función PURA y no alcanzan: pasan en verde aunque
// escanear/actions.ts siga armando la frase a mano — que es exactamente el estado del repositorio
// antes de esta tarea, con la misma frase escrita en dos sitios. El defecto vive en el CONSUMIDOR,
// así que la prueba tiene que mirar al consumidor.
//
// No hay pruebas de componentes ni de Server Actions en este repo (environment: 'node', y estas
// acciones están detrás de verifyComercioAcceso), así que el candado se pone sobre el archivo
// fuente — misma técnica que lib/marca.test.ts usa con el nombre viejo del producto.
describe('el escáner no arma la confirmación a mano', () => {
  const fuente = readFileSync(
    join(__dirname, '..', '..', 'app', 'comercio', '(protegido)', 'escanear', 'actions.ts'),
    'utf8',
  );

  it('ningún sitio tiene la frase de sellos cableada', () => {
    // MUTACIÓN (2026-09-08): devolver la frase fija en CUALQUIERA de los dos sitios —la
    // acreditación normal o el default del switch por tipo— hace fallar esta prueba con
    // "la confirmación volvió a quedar cableada en escanear/actions.ts".
    expect(fuente, 'la confirmación volvió a quedar cableada en escanear/actions.ts').not.toContain(
      'Sello agregado',
    );
    expect(fuente, 'la confirmación volvió a quedar cableada en escanear/actions.ts').not.toContain(
      'puntos agregados',
    );
  });

  it('el sitio de acreditación pasa por mensajeAcreditacion', () => {
    // Eran DOS sitios (accionAcreditar y el default del switch por tipo) y contarlos atrapaba el
    // arreglo a medias. Desde el 2026-09-13 queda UNO: accionAcreditar se retiró y la operación
    // normal y la autorizada comparten ejecutarOperacion. Si vuelve a aparecer una segunda copia de
    // la acreditación, este conteo lo dice.
    const usos = fuente.match(/mensajeAcreditacion\(/g) ?? [];
    expect(usos.length, 'la acreditación del escáner dejó de pasar por mensajeAcreditacion, o se duplicó').toBe(1);
  });
});
