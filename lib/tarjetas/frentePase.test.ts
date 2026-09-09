import { describe, it, expect } from 'vitest';
import { frentePase } from './frentePase';

// EL frente del pass: qué va en el campo primario (sobre la franja), qué en el secundario (debajo),
// qué en el encabezado (el nombre del pase) y qué en la línea de listado (la única que consume
// Google). Vivía inline en generarPassApple y la vista previa lo re-adivinaba con su propio if/else
// — que es como la vista previa de una membresía terminó diciendo "PUNTOS 0" (2026-09-08).
//
// `hoyIso` entra por argumento, igual que en describirSaldo: sin fecha por parámetro no se puede
// probar el borde del vencimiento sin congelar el reloj.
const HOY = '2026-09-09';

// Lo que no varía en cada caso. Se escribe explícito y no con valores por defecto en la firma:
// los cuatro campos nuevos son OBLIGATORIOS a propósito, para que una ruta de emisión nueva no
// pueda armar un frente sin decidir qué sabe de la vigencia.
const base = { vigenciaHasta: null, usadoEn: null, nombrePase: null, hoyIso: HOY };

describe('frentePase', () => {
  it('descuento: ningún campo (su estado es un nivel, y frentePase no recibe el porcentaje)', () => {
    expect(frentePase({ ...base, tipoTarjeta: 'descuento', puntos: 0, selloMeta: null, hayGrilla: false })).toEqual({
      primario: null,
      secundario: null,
      encabezado: null,
      listado: null,
    });
  });

  it('puntos: primario "PUNTOS" con el número pelado (para numberStyle), y listado igual', () => {
    expect(frentePase({ ...base, tipoTarjeta: 'puntos', puntos: 120, selloMeta: null, hayGrilla: false })).toEqual({
      primario: { etiqueta: 'PUNTOS', valor: '120', numero: 120 },
      secundario: null,
      encabezado: null,
      listado: { etiqueta: 'PUNTOS', valor: '120', numero: 120 },
    });
  });

  it('gift card: primario "SALDO" en dólares y SIN número (el entero son centavos)', () => {
    // MUTACIÓN: devolver `numero: puntos` acá reintroduce el "PUNTOS 2500" del 2026-07-30.
    const frente = frentePase({ ...base, tipoTarjeta: 'gift_card', puntos: 2500, selloMeta: null, hayGrilla: false });
    expect(frente.primario).toEqual({ etiqueta: 'SALDO', valor: '$25.00', numero: null });
    expect(frente.listado).toEqual({ etiqueta: 'SALDO', valor: '$25.00', numero: null });
  });

  it('sellos CON grilla: nada sobre la franja (taparía los sellos) y "7 de 10" debajo', () => {
    // MUTACIÓN: ignorar `hayGrilla` (tratarlo siempre como false) sube el texto encima de la grilla.
    const frente = frentePase({ ...base, tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: true });
    expect(frente.primario).toBeNull();
    expect(frente.secundario).toEqual({ etiqueta: 'SELLOS', valor: '7 de 10', numero: null });
  });

  it('sellos CON grilla: el listado SIGUE llevando el contador, con la palabra "sellos"', () => {
    // Es lo que se lee en la vista de LISTA de Google Wallet, donde no cabe la imagen de la grilla.
    // Por eso `listado` existe aparte de `primario`: tomar `primario` acá dejaría a Android sin
    // ningún contador, y la palabra tiene que venir de acá (si no, Google la agregaría encima y
    // saldría "7 de 10 sellos sellos").
    expect(
      frentePase({ ...base, tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: true }).listado,
    ).toEqual({ etiqueta: 'SELLOS', valor: '7 de 10 sellos', numero: null });
  });

  it('sellos SIN grilla (franja propia o composición fallida): primario "7 de 10 sellos"', () => {
    // MUTACIÓN: tratar `hayGrilla` siempre como true deja la franja propia sin ningún contador encima.
    const frente = frentePase({ ...base, tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, hayGrilla: false });
    expect(frente.primario).toEqual({ etiqueta: 'SELLOS', valor: '7 de 10 sellos', numero: null });
    expect(frente.secundario).toBeNull();
    expect(frente.listado).toEqual({ etiqueta: 'SELLOS', valor: '7 de 10 sellos', numero: null });
  });

  it('sellos sin meta: cae al entero pelado, nunca "7 de null"', () => {
    const frente = frentePase({ ...base, tipoTarjeta: 'sellos', puntos: 7, selloMeta: null, hayGrilla: true });
    expect(frente.primario).toEqual({ etiqueta: 'SELLOS', valor: '7', numero: 7 });
    // El número PELADO viaja también al listado: es lo que hace que Google mande balance.int y le
    // ponga los separadores de miles del teléfono.
    expect(frente.listado).toEqual({ etiqueta: 'SELLOS', valor: '7', numero: 7 });
  });
});

// El defecto que abre este grupo: el frente del pase de una membresía mostraba SOLO el logo, la
// franja y el nombre del cliente. Ni cómo se llama la tarjeta ni hasta cuándo está activa — mientras
// el borrador de términos que la propia app genera prometía "hasta la fecha que aparece en la
// tarjeta", una fecha que no aparecía en ninguna parte.
describe('frentePase — vigencia de membresía y cupón', () => {
  it('membresía vigente: "Activa hasta el …" en el primario y en el listado', () => {
    // MUTACIÓN: quitar `vigenciaHasta` del frente (volver a devolver null para membresía) deja el
    // pase exactamente como el defecto que esta tarea cierra.
    const frente = frentePase({
      ...base,
      tipoTarjeta: 'membresia',
      puntos: 0,
      selloMeta: null,
      hayGrilla: false,
      vigenciaHasta: '2026-10-12',
    });
    expect(frente.primario).toEqual({
      etiqueta: 'MEMBRESÍA',
      valor: 'Activa hasta el 12 de octubre de 2026',
      numero: null,
    });
    expect(frente.listado).toEqual(frente.primario);
    expect(frente.secundario).toBeNull();
  });

  it('membresía vencida: "Vencida el …" — el borde se decide con hoyIso, no con el reloj', () => {
    // El día MISMO del vencimiento la membresía sigue activa (sigueVigente compara >=): un socio
    // que paga hasta el 9 tiene el 9 completo.
    const ultimoDia = frentePase({
      ...base,
      tipoTarjeta: 'membresia', puntos: 0, selloMeta: null, hayGrilla: false,
      vigenciaHasta: '2026-09-09',
    });
    expect(ultimoDia.primario!.valor).toBe('Activa hasta el 9 de septiembre de 2026');

    const vencida = frentePase({
      ...base,
      tipoTarjeta: 'membresia', puntos: 0, selloMeta: null, hayGrilla: false,
      vigenciaHasta: '2026-09-08',
    });
    expect(vencida.primario!.valor).toBe('Vencida el 8 de septiembre de 2026');
  });

  it('membresía sin fecha (recién emitida): "Sin activar", sin mirar el reloj', () => {
    // Es lo que pasa la vista previa del editor de marca, que no tiene ninguna tarjeta emitida.
    const frente = frentePase({
      ...base, tipoTarjeta: 'membresia', puntos: 0, selloMeta: null, hayGrilla: false,
    });
    expect(frente.primario).toEqual({ etiqueta: 'MEMBRESÍA', valor: 'Sin activar', numero: null });
  });

  it('cupón: disponible, con fecha, vencido y ya usado', () => {
    const sinFecha = frentePase({ ...base, tipoTarjeta: 'cupon', puntos: 0, selloMeta: null, hayGrilla: false });
    expect(sinFecha.primario).toEqual({ etiqueta: 'CUPÓN', valor: 'Disponible', numero: null });

    const conFecha = frentePase({
      ...base, tipoTarjeta: 'cupon', puntos: 0, selloMeta: null, hayGrilla: false,
      vigenciaHasta: '2026-09-30',
    });
    expect(conFecha.primario!.valor).toBe('Disponible hasta el 30 de septiembre de 2026');

    const vencido = frentePase({
      ...base, tipoTarjeta: 'cupon', puntos: 0, selloMeta: null, hayGrilla: false,
      vigenciaHasta: '2026-08-03',
    });
    expect(vencido.primario!.valor).toBe('Venció el 3 de agosto de 2026');

    // `usadoEn` gana sobre la fecha: un cupón usado ya no está "disponible" aunque no haya vencido.
    const usado = frentePase({
      ...base, tipoTarjeta: 'cupon', puntos: 0, selloMeta: null, hayGrilla: false,
      vigenciaHasta: '2026-09-30', usadoEn: '2026-09-05T15:00:00Z',
    });
    expect(usado.primario!.valor).toBe('Ya usado');
  });
});

describe('frentePase — encabezado (el nombre del pase)', () => {
  it('sin nombre configurado el encabezado es null: el pase sale como hasta ahora', () => {
    expect(
      frentePase({ ...base, tipoTarjeta: 'puntos', puntos: 5, selloMeta: null, hayGrilla: false }).encabezado,
    ).toBeNull();
  });

  it('el nombre viaja al encabezado, recortado, y NO depende del tipo', () => {
    for (const tipo of ['puntos', 'sellos', 'membresia', 'cupon', 'descuento', 'gift_card']) {
      expect(
        frentePase({
          ...base, tipoTarjeta: tipo, puntos: 0, selloMeta: null, hayGrilla: false,
          nombrePase: '  Socio Oro  ',
        }).encabezado,
      ).toBe('Socio Oro');
    }
  });

  it('un nombre en blanco es lo mismo que no tenerlo (nunca un encabezado vacío en el pase)', () => {
    // La columna tiene un CHECK que lo impide, pero el pase lee filas que pueden venir de un
    // backfill viejo o de otra ruta de escritura: acá se DESCARTA, no se dibuja un campo vacío.
    expect(
      frentePase({
        ...base, tipoTarjeta: 'puntos', puntos: 5, selloMeta: null, hayGrilla: false, nombrePase: '   ',
      }).encabezado,
    ).toBeNull();
  });
});
