import { describe, it, expect } from 'vitest';
import {
  TIPOS,
  buscarTipo,
  tipoOPuntos,
  formatearCentavos,
  centavosDesdeTexto,
  describirSaldo,
  sigueVigente,
  nivelParaAcumulado,
  puedeCanjearRecompensas,
  aplicanControlesAcreditacion,
  usaMontoDeCompra,
  aplicaReglaDeMonto,
} from './tipos';

// Módulo puro. Lo que se prueba acá es lo que, si falla, le muestra plata equivocada a un cliente.

const HOY = '2026-07-28';

describe('catálogo', () => {
  it('tiene ocho tipos', () => {
    // Cuántos, nada más. Que COINCIDAN con lo que acepta la BD no se puede probar acá: comparar el
    // catálogo contra una lista escrita en el mismo test no verifica nada — es lo que hacía esta
    // prueba antes y por eso no atrapó que 'multipass' no existe en el CHECK (el octavo tipo se
    // llama 'prepago'). La verificación real vive en tiposEnBd.test.ts, que los inserta.
    expect(TIPOS).toHaveLength(8);
  });

  it('marca como "requiere monto" exactamente a los que no funcionan sin él', () => {
    // cashback calcula un porcentaje de la compra, gift card descuenta del saldo lo que se gastó, y
    // descuento acumula gasto. Los tres son inservibles sin el monto.
    const conMonto = TIPOS.filter((t) => t.requiereMonto).map((t) => t.valor).sort();
    expect(conMonto).toEqual(['cashback', 'descuento', 'gift_card']);
  });

  it('un tipo desconocido degrada a puntos en vez de romper', () => {
    // Una fila vieja o un valor escrito a mano no debe dejar a un cliente sin poder ver su tarjeta.
    expect(buscarTipo('lo-que-sea')).toBeNull();
    expect(tipoOPuntos('lo-que-sea').valor).toBe('puntos');
  });
});

describe('formatearCentavos', () => {
  it('escribe siempre dos decimales', () => {
    expect(formatearCentavos(1250)).toBe('$12.50');
    expect(formatearCentavos(5)).toBe('$0.05');
    expect(formatearCentavos(100)).toBe('$1.00');
    expect(formatearCentavos(0)).toBe('$0.00');
  });

  it('no se come el cero de los centavos redondos', () => {
    // El bug clásico de dividir por 100 y confiar en toString: 1200/100 = 12 → "$12" en vez de
    // "$12.00", que en un saldo se lee como una cifra distinta.
    expect(formatearCentavos(1200)).toBe('$12.00');
    expect(formatearCentavos(1205)).toBe('$12.05');
  });

  it('maneja negativos, que aparecen al corregir de más', () => {
    expect(formatearCentavos(-350)).toBe('-$3.50');
  });
});

describe('centavosDesdeTexto', () => {
  it('convierte sin pasar por punto flotante', () => {
    // Number('19.99') * 100 da 1998.9999999999998. Acá se multiplica sobre el string partido, así
    // que no hay redondeo que salga mal.
    expect(centavosDesdeTexto('19.99')).toBe(1999);
    expect(centavosDesdeTexto('12.50')).toBe(1250);
    expect(centavosDesdeTexto('0.07')).toBe(7);
    expect(centavosDesdeTexto('100')).toBe(10000);
  });

  it('acepta lo que la gente teclea de verdad', () => {
    expect(centavosDesdeTexto(' $12.50 ')).toBe(1250);
    expect(centavosDesdeTexto('12,50')).toBe(1250);
    expect(centavosDesdeTexto('12.5')).toBe(1250);
  });

  it('devuelve null en vez de NaN ante basura', () => {
    // Un NaN acá termina guardado como saldo. null obliga al caller a decidir.
    for (const valor of ['', 'abc', '12.345', '-5', '1.2.3']) {
      expect(centavosDesdeTexto(valor), `"${valor}"`).toBeNull();
    }
  });
});

describe('sigueVigente', () => {
  it('el día del vencimiento TODAVÍA cuenta', () => {
    // Se compara como texto y no como Date a propósito: comparar instantes hace que un pase venza
    // a medianoche UTC, o sea a las 6 de la tarde del día ANTERIOR en El Salvador.
    expect(sigueVigente('2026-07-28', HOY)).toBe(true);
    expect(sigueVigente('2026-07-29', HOY)).toBe(true);
    expect(sigueVigente('2026-07-27', HOY)).toBe(false);
  });

  it('sin fecha no hay vigencia', () => {
    expect(sigueVigente(null, HOY)).toBe(false);
    expect(sigueVigente(undefined, HOY)).toBe(false);
  });
});

describe('describirSaldo', () => {
  it('cashback y gift card se leen como PLATA, no como puntos', () => {
    // El riesgo central de reusar puntos_actuales como contador universal: el mismo 1250 es
    // "$12.50" o "1250 puntos" según el tipo. Si esto falla, un cliente ve un saldo falso.
    expect(describirSaldo({ tipo: 'cashback', contador: 1250 }, HOY)).toBe('$12.50 disponibles');
    expect(describirSaldo({ tipo: 'gift_card', contador: 1250 }, HOY)).toBe('$12.50 disponibles');
    expect(describirSaldo({ tipo: 'puntos', contador: 1250 }, HOY)).toBe('1250 puntos');
  });

  it('sellos con y sin meta', () => {
    expect(describirSaldo({ tipo: 'sellos', contador: 3, selloMeta: 10 }, HOY)).toBe('3 de 10 sellos');
    expect(describirSaldo({ tipo: 'sellos', contador: 3, selloMeta: null }, HOY)).toBe('3 sellos');
  });

  it('prepago cuenta visitas y concuerda en singular', () => {
    expect(describirSaldo({ tipo: 'prepago', contador: 4 }, HOY)).toBe('4 visitas disponibles');
    expect(describirSaldo({ tipo: 'prepago', contador: 1 }, HOY)).toBe('1 visita disponible');
    expect(describirSaldo({ tipo: 'prepago', contador: 0 }, HOY)).toBe('0 visitas disponibles');
  });

  it('puntos concuerda en singular', () => {
    expect(describirSaldo({ tipo: 'puntos', contador: 1 }, HOY)).toBe('1 punto');
  });

  it('cupón distingue disponible, usado y vencido', () => {
    const base = { tipo: 'cupon', contador: 0, vigenciaHasta: '2026-07-30' };
    expect(describirSaldo(base, HOY)).toBe('Disponible hasta el 30 de julio de 2026');
    // Usado gana sobre vigente: da igual que le quedaran días.
    expect(describirSaldo({ ...base, usadoEn: '2026-07-20T10:00:00Z' }, HOY)).toBe('Ya usado');
    expect(describirSaldo({ ...base, vigenciaHasta: '2026-07-01' }, HOY)).toBe('Venció el 1 de julio de 2026');
  });

  it('membresía distingue activa, vencida y sin activar', () => {
    expect(describirSaldo({ tipo: 'membresia', contador: 0, vigenciaHasta: '2026-08-30' }, HOY))
      .toBe('Activa hasta el 30 de agosto de 2026');
    expect(describirSaldo({ tipo: 'membresia', contador: 0, vigenciaHasta: '2026-07-01' }, HOY))
      .toBe('Vencida el 1 de julio de 2026');
    expect(describirSaldo({ tipo: 'membresia', contador: 0, vigenciaHasta: null }, HOY))
      .toBe('Sin activar');
  });

  it('descuento muestra el nivel, no el contador', () => {
    expect(describirSaldo({ tipo: 'descuento', contador: 0, porcentajeDescuento: 15 }, HOY))
      .toBe('15% de descuento');
    expect(describirSaldo({ tipo: 'descuento', contador: 0, porcentajeDescuento: null }, HOY))
      .toBe('Sin descuento todavía');
  });
});

describe('nivelParaAcumulado', () => {
  const niveles = [
    { desdeCentavos: 10000, porcentaje: 5 },
    { desdeCentavos: 30000, porcentaje: 10 },
    { desdeCentavos: 50000, porcentaje: 15 },
  ];

  it('gana el umbral MÁS ALTO ya superado', () => {
    // Con "el primero que coincide" el cliente se quedaría para siempre en 5%.
    expect(nivelParaAcumulado(60000, niveles)).toBe(15);
    expect(nivelParaAcumulado(35000, niveles)).toBe(10);
    expect(nivelParaAcumulado(12000, niveles)).toBe(5);
  });

  it('el umbral exacto YA cuenta', () => {
    // Con `>` en vez de `>=`, un cliente que gastó exactamente $100 no vería su 5%.
    expect(nivelParaAcumulado(10000, niveles)).toBe(5);
  });

  it('sin llegar al primer umbral no hay nivel', () => {
    expect(nivelParaAcumulado(9999, niveles)).toBeNull();
    expect(nivelParaAcumulado(0, niveles)).toBeNull();
  });

  it('sin niveles configurados no hay nivel', () => {
    expect(nivelParaAcumulado(999999, [])).toBeNull();
  });

  it('no depende del orden en que vengan los niveles', () => {
    const desordenados = [niveles[2], niveles[0], niveles[1]];
    expect(nivelParaAcumulado(60000, desordenados)).toBe(15);
  });
});

describe('puedeCanjearRecompensas', () => {
  // Un premio se canjea DESCONTANDO `puntos_actuales` (canjear_recompensa_atomico, 0009). En cupón,
  // membresía y descuento ese contador es 0 para siempre —— su estado es una fecha o un nivel ——
  // así que el botón "Canjear" del escáner sale deshabilitado en TODOS los premios, siempre, y el
  // cajero se queda con una lista que nunca va a poder usar en la pantalla más usada del mostrador.
  it('solo los tipos con contador pueden canjear un premio', () => {
    const pueden = TIPOS.filter((t) => puedeCanjearRecompensas(t.valor)).map((t) => t.valor).sort();
    expect(pueden).toEqual(['cashback', 'gift_card', 'prepago', 'puntos', 'sellos']);
  });

  it('cupón, membresía y descuento no: su contador no se mueve nunca', () => {
    for (const valor of ['cupon', 'membresia', 'descuento']) {
      expect(puedeCanjearRecompensas(valor), `"${valor}" no tiene contador del que descontar`).toBe(false);
    }
  });

  it('un tipo desconocido degrada a puntos, que sí puede', () => {
    // Misma política que el resto del módulo: una fila vieja no deja al cajero sin la lista.
    expect(puedeCanjearRecompensas('lo-que-sea')).toBe(true);
  });
});

describe('aplicanControlesAcreditacion', () => {
  // Los cuatro límites antifraude (tope diario, espera mínima, techo por transacción, tope diario
  // de puntos) viven DENTRO de acreditar_atomico (0015) y ninguna otra función los consulta ——
  // verificado leyendo 0019 (usar_cupon_atomico / renovar_membresia_atomico), 0020
  // (usar_visita_atomico), 0022 (consumir_saldo_atomico) y 0023 (registrar_compra_atomico).
  it('exactamente los tipos que tienen ALGUNA operación por acreditar_atomico', () => {
    const aplican = TIPOS.filter((t) => aplicanControlesAcreditacion(t.valor)).map((t) => t.valor).sort();
    // prepago y gift_card entran por su SEGUNDA operación (vender paquete, cargar saldo), que sí
    // acredita: el techo por transacción es lo único que impide que un cajero regale una gift card
    // de $500. Sacarlos de la lista dejaría esa carga sin ningún límite configurable.
    expect(aplican).toEqual(['cashback', 'gift_card', 'prepago', 'puntos', 'sellos']);
  });

  it('cupón, membresía y descuento no consultan ninguna de las cuatro perillas', () => {
    for (const valor of ['cupon', 'membresia', 'descuento']) {
      expect(aplicanControlesAcreditacion(valor), `"${valor}" no pasa por acreditar_atomico`).toBe(false);
    }
  });

  it('la respuesta sale del CATÁLOGO, no de una lista escrita aparte', () => {
    // Un noveno tipo no compila sin declarar el campo, así que no puede heredar "sí, aplican" por
    // descuido —— que es exactamente cómo membresía y cupón llegaron a ofrecer estas perillas.
    for (const tipo of TIPOS) {
      expect(typeof tipo.aplicanControlesAcreditacion, tipo.valor).toBe('boolean');
      expect(aplicanControlesAcreditacion(tipo.valor)).toBe(tipo.aplicanControlesAcreditacion);
    }
  });

  it('hoy coincide con puedeCanjearRecompensas, y es una COINCIDENCIA', () => {
    // Se derivan de cosas distintas: una pregunta si hay contador del que descontar, la otra por
    // qué RPC viaja la operación. Que hoy den la misma lista no autoriza a fusionarlas —— un tipo
    // nuevo que renueve por acreditar_atomico sin contador las separaría, y fusionadas le daría al
    // cajero una lista de premios incanjeable o al dueño unas perillas muertas, según cuál ganara.
    for (const tipo of TIPOS) {
      expect(aplicanControlesAcreditacion(tipo.valor), tipo.valor).toBe(puedeCanjearRecompensas(tipo.valor));
    }
  });
});

describe('usaMontoDeCompra', () => {
  // La casilla `pedir_monto_compra` le hace teclear al cajero el monto de la compra. Solo sirve si
  // alguna operación de la tarjeta se lo ENTREGA a su RPC —— verificado firma por firma: 0015
  // (acreditar_atomico, p_monto_compra), 0019 (usar_cupon_atomico / renovar_membresia_atomico, sin
  // monto), 0020 (usar_visita_atomico, sin monto), 0022 (consumir_saldo_atomico, p_monto) y 0023
  // (registrar_compra_atomico, p_monto_centavos). Donde no llega, el cajero escribía un dato que se
  // tiraba a la basura.
  //
  // MUTACIÓN verificada: `usaMontoDeCompra: true` en membresía hace fallar las dos primeras.
  it('exactamente los tipos cuya operación le entrega el monto a su RPC', () => {
    const usan = TIPOS.filter((t) => usaMontoDeCompra(t.valor)).map((t) => t.valor).sort();
    expect(usan).toEqual(['cashback', 'descuento', 'gift_card', 'puntos', 'sellos']);
  });

  it('cupón, membresía y prepago no: ninguna de sus operaciones recibe el monto', () => {
    // prepago es el que no se ve a simple vista: usar una visita no recibe monto (0020), y vender el
    // paquete pasa por acreditar_atomico —que sí tiene p_monto_compra— pero el escáner nunca se lo
    // pasa. Hoy el dato se descarta igual que en cupón y membresía.
    for (const valor of ['cupon', 'membresia', 'prepago']) {
      expect(usaMontoDeCompra(valor), `"${valor}" descarta el monto de la compra`).toBe(false);
    }
  });

  it('todo tipo que EXIGE el monto también lo usa', () => {
    // La implicación que tiene que valer siempre: si el escáner obliga a teclearlo, no puede ser para
    // tirarlo. Al revés no vale —— puntos y sellos lo usan sin exigirlo —— y por eso son dos campos.
    for (const tipo of TIPOS) {
      if (tipo.requiereMonto) expect(tipo.usaMontoDeCompra, tipo.valor).toBe(true);
    }
  });

  it('la respuesta sale del CATÁLOGO, no de una lista escrita aparte', () => {
    for (const tipo of TIPOS) {
      expect(typeof tipo.usaMontoDeCompra, tipo.valor).toBe('boolean');
      expect(usaMontoDeCompra(tipo.valor)).toBe(tipo.usaMontoDeCompra);
    }
  });

  it('un tipo desconocido degrada a puntos, que sí lo usa', () => {
    expect(usaMontoDeCompra('lo-que-sea')).toBe(true);
  });
});

describe('aplicaReglaDeMonto', () => {
  // La regla de monto obligatorio / mínimo de compra del comercio (migración 0039) solo tiene
  // sentido donde el monto es OPCIONAL por defecto: puntos y sellos. En cashback, gift card y
  // descuento el monto YA es obligatorio por su propio tipo (requiereMonto) — superponerles un
  // mínimo sería una regla que nadie pidió. Prepago, cupón y membresía no reciben monto en
  // absoluto, así que no hay nada que gatear.
  //
  // MUTACIÓN verificada: `aplicaReglaDeMonto: true` en cashback hace fallar las dos primeras.
  it('exactamente puntos y sellos', () => {
    const aplican = TIPOS.filter((t) => aplicaReglaDeMonto(t.valor)).map((t) => t.valor).sort();
    expect(aplican).toEqual(['puntos', 'sellos']);
  });

  it('los otros seis no: monto ya obligatorio por su tipo, o ningún monto en absoluto', () => {
    for (const valor of ['prepago', 'gift_card', 'cashback', 'cupon', 'membresia', 'descuento']) {
      expect(aplicaReglaDeMonto(valor), `"${valor}" no recibe la regla de monto del comercio`).toBe(false);
    }
  });

  it('la respuesta sale del CATÁLOGO, no de una lista escrita aparte', () => {
    for (const tipo of TIPOS) {
      expect(typeof tipo.aplicaReglaDeMonto, tipo.valor).toBe('boolean');
      expect(aplicaReglaDeMonto(tipo.valor)).toBe(tipo.aplicaReglaDeMonto);
    }
  });

  it('un tipo desconocido degrada a puntos, que sí la recibe', () => {
    // Mismo fallback que el resto del módulo: una fila vieja no deja al cajero sin ningún control.
    expect(aplicaReglaDeMonto('lo-que-sea')).toBe(true);
  });

  it('todo tipo con aplicaReglaDeMonto también tiene usaMontoDeCompra', () => {
    // La implicación que tiene que valer siempre, mismo patrón que "todo tipo que EXIGE el monto
    // también lo usa" (describe usaMontoDeCompra, arriba): no tiene sentido gatear con un mínimo un
    // monto que la operación ni siquiera recibe. Al revés no vale —cashback, gift card y descuento
    // usan el monto y no reciben la regla— por eso son campos separados.
    for (const tipo of TIPOS) {
      if (tipo.aplicaReglaDeMonto) expect(tipo.usaMontoDeCompra, tipo.valor).toBe(true);
    }
  });
});
