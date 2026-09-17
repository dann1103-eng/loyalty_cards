import { describe, it, expect } from 'vitest';
import { frentePase, PIE_CODIGO, type Franja } from './frentePase';
import { TIPOS } from './tipos';

// EL frente del pase, lugar por lugar, en el orden de los diseños (spec 2026-09-17): el ESTADO arriba
// a la derecha, el nombre del pase SOBRE la franja solo si la franja es la banda lisa, NOMBRE y
// APELLIDO debajo, y la línea de listado (la única que consume Google en `loyaltyPoints`). Vivía
// inline en generarPassApple y la vista previa lo re-adivinaba con su propio if/else — que es como la
// vista previa de una membresía terminó diciendo "PUNTOS 0" (2026-09-08).
//
// `hoyIso` entra por argumento, igual que en describirSaldo: sin fecha por parámetro no se puede
// probar el borde del vencimiento sin congelar el reloj.
const HOY = '2026-09-09';

// Lo que no varía en cada caso. Se escribe explícito y no con valores por defecto en la firma: las
// entradas son OBLIGATORIAS a propósito, para que un consumidor nuevo tenga que decidir cada una
// (qué hay de verdad en la franja, qué sabe de la vigencia, si tiene el nombre del cliente).
const base = {
  vigenciaHasta: null,
  usadoEn: null,
  nombrePase: null,
  hoyIso: HOY,
  franja: 'banda' as Franja,
  nombreCliente: null,
  apellidoCliente: null,
};

describe('frentePase — la forma del contrato', () => {
  it('devuelve EXACTAMENTE estado, sobreFranja, titular y listado (primario/secundario/encabezado ya no existen)', () => {
    // Dejar los lugares viejos convive con la trampa de que un consumidor siga leyendo el lugar
    // equivocado: el compilador tiene que marcarlo, y esta prueba lo fija en tiempo de ejecución.
    const frente = frentePase({ ...base, tipoTarjeta: 'puntos', puntos: 1, selloMeta: null });
    expect(Object.keys(frente).sort()).toEqual(['estado', 'listado', 'sobreFranja', 'titular']);
  });

  it('una membresía vigente, en banda, con nombre y apellido: el frente completo', () => {
    expect(
      frentePase({
        ...base,
        tipoTarjeta: 'membresia',
        puntos: 0,
        selloMeta: null,
        vigenciaHasta: '2026-10-16',
        nombrePase: 'Mensualidad VIP',
        nombreCliente: 'María',
        apellidoCliente: 'Rivera',
      }),
    ).toEqual({
      estado: { etiqueta: 'VÁLIDO HASTA', valor: '16/10/2026', numero: null },
      sobreFranja: 'Mensualidad VIP',
      titular: { nombre: 'María', apellido: 'Rivera' },
      listado: { etiqueta: 'MEMBRESÍA', valor: 'Activa hasta el 16 de octubre de 2026', numero: null },
    });
  });

  it('PIE_CODIGO es el literal del diseño, no MARCA.nombre ("Cardly SV")', () => {
    expect(PIE_CODIGO).toBe('Powered by Cardly');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `estado`: arriba a la derecha. Una prueba por fila de la tabla del spec.
// ─────────────────────────────────────────────────────────────────────────────
describe('frentePase — estado (arriba a la derecha)', () => {
  const estadoDe = (d: Partial<Parameters<typeof frentePase>[0]> & { tipoTarjeta: string }) =>
    frentePase({ ...base, puntos: 0, selloMeta: null, ...d }).estado;

  // MUTACIÓN (b) (frentePase.ts, estadoVigencia): `formatearFechaCorta(vigenciaHasta)` →
  // `formatearFecha(vigenciaHasta)`. Falla esta prueba (y las otras ocho con fecha en `estado`) con
  // `expected { etiqueta: 'VÁLIDO HASTA', …(2) } to deeply equal { etiqueta: 'VÁLIDO HASTA', …(2) }`,
  // diff `- "valor": "16/10/2026"` / `+ "valor": "16 de octubre de 2026"`: la frase larga no entra
  // al lado del logo.
  it('membresía vigente: VÁLIDO HASTA · 16/10/2026, con la fecha CORTA y sin número', () => {
    expect(estadoDe({ tipoTarjeta: 'membresia', vigenciaHasta: '2026-10-16' })).toEqual({
      etiqueta: 'VÁLIDO HASTA',
      valor: '16/10/2026',
      numero: null,
    });
  });

  it('membresía vencida: VENCIÓ EL · 03/08/2026', () => {
    expect(estadoDe({ tipoTarjeta: 'membresia', vigenciaHasta: '2026-08-03' })).toEqual({
      etiqueta: 'VENCIÓ EL',
      valor: '03/08/2026',
      numero: null,
    });
  });

  it('membresía sin fecha: MEMBRESÍA · Sin activar, sin mirar el reloj', () => {
    // Es lo que pasa la vista previa del editor de marca, que no tiene ninguna tarjeta emitida.
    expect(estadoDe({ tipoTarjeta: 'membresia' })).toEqual({
      etiqueta: 'MEMBRESÍA',
      valor: 'Sin activar',
      numero: null,
    });
  });

  // MUTACIÓN (d) (frentePase.ts, estadoVigencia): `sigueVigente(vigenciaHasta, hoyIso)` →
  // `vigenciaHasta.slice(0, 10) > hoyIso.slice(0, 10)`. Falla esta prueba (y la del último día del
  // cupón) con `expected { etiqueta: 'VENCIÓ EL', …(2) } to deeply equal { etiqueta: 'VÁLIDO HASTA', …(2) }`:
  // el socio que pagó hasta el 9 perdería el 9 entero.
  it('membresía: el ÚLTIMO día todavía es VÁLIDO HASTA; el día siguiente, VENCIÓ EL', () => {
    const tarjeta = { tipoTarjeta: 'membresia', vigenciaHasta: '2026-09-09' };
    expect(estadoDe({ ...tarjeta, hoyIso: '2026-09-09' })).toEqual({
      etiqueta: 'VÁLIDO HASTA',
      valor: '09/09/2026',
      numero: null,
    });
    expect(estadoDe({ ...tarjeta, hoyIso: '2026-09-10' })).toEqual({
      etiqueta: 'VENCIÓ EL',
      valor: '09/09/2026',
      numero: null,
    });
  });

  it('membresía: `usadoEn` se ignora (como en describirSaldo); manda la fecha', () => {
    expect(
      estadoDe({ tipoTarjeta: 'membresia', vigenciaHasta: '2026-10-16', usadoEn: '2026-09-05T15:00:00Z' }),
    ).toEqual({ etiqueta: 'VÁLIDO HASTA', valor: '16/10/2026', numero: null });
    expect(estadoDe({ tipoTarjeta: 'membresia', usadoEn: '2026-09-05T15:00:00Z' })).toEqual({
      etiqueta: 'MEMBRESÍA',
      valor: 'Sin activar',
      numero: null,
    });
  });

  it('cupón con fecha, vigente: VÁLIDO HASTA · fecha', () => {
    expect(estadoDe({ tipoTarjeta: 'cupon', vigenciaHasta: '2026-09-30' })).toEqual({
      etiqueta: 'VÁLIDO HASTA',
      valor: '30/09/2026',
      numero: null,
    });
  });

  it('cupón con fecha, vencido: VENCIÓ EL · fecha', () => {
    expect(estadoDe({ tipoTarjeta: 'cupon', vigenciaHasta: '2026-08-03' })).toEqual({
      etiqueta: 'VENCIÓ EL',
      valor: '03/08/2026',
      numero: null,
    });
  });

  it('cupón: el ÚLTIMO día todavía es VÁLIDO HASTA; el día siguiente, VENCIÓ EL', () => {
    const tarjeta = { tipoTarjeta: 'cupon', vigenciaHasta: '2026-09-09' };
    expect(estadoDe({ ...tarjeta, hoyIso: '2026-09-09' })).toEqual({
      etiqueta: 'VÁLIDO HASTA',
      valor: '09/09/2026',
      numero: null,
    });
    expect(estadoDe({ ...tarjeta, hoyIso: '2026-09-10' })).toEqual({
      etiqueta: 'VENCIÓ EL',
      valor: '09/09/2026',
      numero: null,
    });
  });

  it('cupón sin vencimiento: CUPÓN · Disponible', () => {
    expect(estadoDe({ tipoTarjeta: 'cupon' })).toEqual({ etiqueta: 'CUPÓN', valor: 'Disponible', numero: null });
  });

  // MUTACIÓN (c) (frentePase.ts, estadoVigencia): mover la línea de `usado` DESPUÉS de las ramas de la
  // fecha (evaluar la fecha antes que `usadoEn`). Falla esta prueba, y solo esta, con
  // `expected { etiqueta: 'VÁLIDO HASTA', …(2) } to deeply equal { etiqueta: 'CUPÓN', …(2) }`, diff
  // `+ "valor": "30/09/2026"` en vez de `- "valor": "Usado"`: un cupón ya canjeado le diría al cajero
  // que todavía vale. (El usado SIN fecha no la atrapa: sin fecha las dos ramas coinciden.)
  it('cupón usado CON fecha: USADO GANA, vigente o vencida', () => {
    expect(
      estadoDe({ tipoTarjeta: 'cupon', vigenciaHasta: '2026-09-30', usadoEn: '2026-09-05T15:00:00Z' }),
    ).toEqual({ etiqueta: 'CUPÓN', valor: 'Usado', numero: null });
    expect(
      estadoDe({ tipoTarjeta: 'cupon', vigenciaHasta: '2026-08-03', usadoEn: '2026-08-01T15:00:00Z' }),
    ).toEqual({ etiqueta: 'CUPÓN', valor: 'Usado', numero: null });
  });

  it('cupón usado SIN fecha: CUPÓN · Usado', () => {
    expect(estadoDe({ tipoTarjeta: 'cupon', usadoEn: '2026-09-05T15:00:00Z' })).toEqual({
      etiqueta: 'CUPÓN',
      valor: 'Usado',
      numero: null,
    });
  });

  it('gift card y cashback: SALDO · $50.00, SIN número (el entero son centavos)', () => {
    // MUTACIÓN histórica: devolver `numero: puntos` reintroduce el "PUNTOS 2500" del 2026-07-30.
    expect(estadoDe({ tipoTarjeta: 'gift_card', puntos: 5000 })).toEqual({
      etiqueta: 'SALDO',
      valor: '$50.00',
      numero: null,
    });
    expect(estadoDe({ tipoTarjeta: 'cashback', puntos: 5000 })).toEqual({
      etiqueta: 'SALDO',
      valor: '$50.00',
      numero: null,
    });
  });

  it('puntos: PUNTOS · 1250 con el número pelado (Apple le pone el separador del teléfono)', () => {
    expect(estadoDe({ tipoTarjeta: 'puntos', puntos: 1250 })).toEqual({
      etiqueta: 'PUNTOS',
      valor: '1250',
      numero: 1250,
    });
  });

  it('prepago: VISITAS · 4 (número)', () => {
    expect(estadoDe({ tipoTarjeta: 'prepago', puntos: 4 })).toEqual({ etiqueta: 'VISITAS', valor: '4', numero: 4 });
  });

  it('sellos con meta: SELLOS · 7 de 10, con grilla o sin ella', () => {
    for (const franja of ['propia', 'grilla', 'banda'] as const) {
      expect(estadoDe({ tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, franja })).toEqual({
        etiqueta: 'SELLOS',
        valor: '7 de 10',
        numero: null,
      });
    }
  });

  it('sellos sin meta: SELLOS · 7 (número), nunca "7 de null"', () => {
    expect(estadoDe({ tipoTarjeta: 'sellos', puntos: 7 })).toEqual({ etiqueta: 'SELLOS', valor: '7', numero: 7 });
  });

  it('descuento: nada (su estado es un nivel, y frentePase no recibe el porcentaje)', () => {
    expect(estadoDe({ tipoTarjeta: 'descuento', vigenciaHasta: '2026-10-16' })).toBeNull();
  });

  it('todo tipo con vigencia del catálogo está en la tabla: tiene estado, y con SU nombre', () => {
    // Un tipo con `usaVigencia` que no esté en la tabla sale sin estado; nunca hereda "MEMBRESÍA".
    // Esta prueba obliga a quien agregue uno a decidir sus etiquetas: sin fecha, su estado sería null.
    // MUTACIÓN (frentePase.ts, VIGENCIA_POR_TIPO): borrar la fila `cupon`. Falla con
    // `el tipo "cupon" no está en la tabla de vigencia: expected null not to be null`.
    const conVigencia = TIPOS.filter((t) => t.usaVigencia);
    expect(conVigencia.map((t) => t.valor).sort()).toEqual(['cupon', 'membresia']);

    const etiquetas = conVigencia.map((t) => {
      const estado = estadoDe({ tipoTarjeta: t.valor });
      expect(estado, `el tipo "${t.valor}" no está en la tabla de vigencia`).not.toBeNull();
      expect(estadoDe({ tipoTarjeta: t.valor, vigenciaHasta: '2026-10-16' })).toEqual({
        etiqueta: 'VÁLIDO HASTA',
        valor: '16/10/2026',
        numero: null,
      });
      return estado!.etiqueta;
    });
    // Cada uno con su propio nombre: ninguno toma prestado el de otro.
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `sobreFranja`: el nombre del pase, SOLO sobre la banda lisa.
// ─────────────────────────────────────────────────────────────────────────────
describe('frentePase — sobreFranja (el nombre del pase)', () => {
  const sobreFranjaDe = (franja: Franja, nombrePase: string | null, tipoTarjeta = 'puntos') =>
    frentePase({ ...base, tipoTarjeta, puntos: 0, selloMeta: null, franja, nombrePase }).sobreFranja;

  it("'banda': el nombre del pase, recortado", () => {
    expect(sobreFranjaDe('banda', '  Mensualidad VIP  ')).toBe('Mensualidad VIP');
  });

  // MUTACIÓN (a) (frentePase.ts, sobreFranjaDe): `franja === 'banda'` → `franja !== 'grilla'` (escribir
  // el nombre también en 'propia'). Falla esta prueba con `expected 'Mensualidad VIP' to be null`: el
  // texto quedaría encima del que la imagen del comercio ya trae dibujado.
  it("'propia': nada — la imagen del comercio ya trae su texto", () => {
    expect(sobreFranjaDe('propia', 'Mensualidad VIP')).toBeNull();
  });

  it("'grilla': nada — taparía los círculos de los sellos", () => {
    expect(sobreFranjaDe('grilla', 'Mis sellos', 'sellos')).toBeNull();
  });

  it('sin nombre, o en blanco, es null (nunca un campo vacío sobre la banda)', () => {
    // La columna tiene un CHECK que lo impide, pero el pase lee filas que pueden venir de un backfill
    // viejo o de otra ruta de escritura: acá se DESCARTA, no se dibuja un campo vacío.
    expect(sobreFranjaDe('banda', null)).toBeNull();
    expect(sobreFranjaDe('banda', '')).toBeNull();
    expect(sobreFranjaDe('banda', '   ')).toBeNull();
  });

  it('en la banda NO depende del tipo', () => {
    for (const t of TIPOS) {
      expect(sobreFranjaDe('banda', '  Socio Oro  ', t.valor)).toBe('Socio Oro');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `titular`: NOMBRE y APELLIDO debajo de la franja.
// ─────────────────────────────────────────────────────────────────────────────
describe('frentePase — titular (NOMBRE y APELLIDO)', () => {
  const titularDe = (nombreCliente: string | null, apellidoCliente: string | null) =>
    frentePase({ ...base, tipoTarjeta: 'puntos', puntos: 0, selloMeta: null, nombreCliente, apellidoCliente })
      .titular;

  it('con nombre y apellido: los dos', () => {
    expect(titularDe('María', 'Rivera')).toEqual({ nombre: 'María', apellido: 'Rivera' });
  });

  it('recorta los dos', () => {
    expect(titularDe('  María José ', '  López  ')).toEqual({ nombre: 'María José', apellido: 'López' });
  });

  it('sin apellido (un cliente de antes de la 0036): solo el nombre', () => {
    expect(titularDe('María', null)).toEqual({ nombre: 'María', apellido: null });
  });

  it('apellido en blanco vale null', () => {
    expect(titularDe('María', '')).toEqual({ nombre: 'María', apellido: null });
    expect(titularDe('María', '   ')).toEqual({ nombre: 'María', apellido: null });
  });

  it('sin nombre, NI el apellido: un APELLIDO solo a la derecha no nombra a nadie', () => {
    expect(titularDe(null, 'Rivera')).toBeNull();
    expect(titularDe('', 'Rivera')).toBeNull();
    expect(titularDe('   ', 'Rivera')).toBeNull();
    expect(titularDe(null, null)).toBeNull();
  });

  it('no depende de la franja ni del tipo', () => {
    for (const franja of ['propia', 'grilla', 'banda'] as const) {
      for (const t of TIPOS) {
        expect(
          frentePase({
            ...base,
            tipoTarjeta: t.valor,
            puntos: 0,
            selloMeta: null,
            franja,
            nombreCliente: 'María',
            apellidoCliente: 'Rivera',
          }).titular,
        ).toEqual({ nombre: 'María', apellido: 'Rivera' });
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `listado`: SIN CAMBIOS respecto del contrato anterior. Es la línea única que Google usa en
// `loyaltyPoints` y en la vista de lista de Wallet, donde no hay grilla.
// ─────────────────────────────────────────────────────────────────────────────
describe('frentePase — listado (sin cambios)', () => {
  it('descuento: null', () => {
    expect(frentePase({ ...base, tipoTarjeta: 'descuento', puntos: 0, selloMeta: null }).listado).toBeNull();
  });

  it('puntos: "PUNTOS" con el número pelado', () => {
    expect(frentePase({ ...base, tipoTarjeta: 'puntos', puntos: 120, selloMeta: null }).listado).toEqual({
      etiqueta: 'PUNTOS',
      valor: '120',
      numero: 120,
    });
  });

  it('gift card: "SALDO" en dólares y SIN número (el entero son centavos)', () => {
    expect(frentePase({ ...base, tipoTarjeta: 'gift_card', puntos: 2500, selloMeta: null }).listado).toEqual({
      etiqueta: 'SALDO',
      valor: '$25.00',
      numero: null,
    });
  });

  it('sellos con meta: "7 de 10 sellos", con la palabra, en las TRES franjas', () => {
    // Con grilla también: es lo que se lee en la vista de LISTA de Google Wallet, donde no cabe la
    // imagen de la grilla. Y la palabra tiene que venir de acá (si no, Google la agregaría encima y
    // saldría "7 de 10 sellos sellos"). El listado no depende de la franja.
    for (const franja of ['propia', 'grilla', 'banda'] as const) {
      expect(frentePase({ ...base, tipoTarjeta: 'sellos', puntos: 7, selloMeta: 10, franja }).listado).toEqual({
        etiqueta: 'SELLOS',
        valor: '7 de 10 sellos',
        numero: null,
      });
    }
  });

  it('sellos sin meta: cae al entero pelado, nunca "7 de null"', () => {
    // El número PELADO viaja al listado: es lo que hace que Google mande balance.int y le ponga los
    // separadores de miles del teléfono.
    expect(frentePase({ ...base, tipoTarjeta: 'sellos', puntos: 7, selloMeta: null, franja: 'grilla' }).listado).toEqual(
      { etiqueta: 'SELLOS', valor: '7', numero: 7 },
    );
  });

  it('membresía vigente: la frase larga de describirSaldo con etiqueta MEMBRESÍA', () => {
    expect(
      frentePase({ ...base, tipoTarjeta: 'membresia', puntos: 0, selloMeta: null, vigenciaHasta: '2026-10-12' })
        .listado,
    ).toEqual({ etiqueta: 'MEMBRESÍA', valor: 'Activa hasta el 12 de octubre de 2026', numero: null });
  });

  it('membresía: el borde se decide con hoyIso, no con el reloj', () => {
    // El día MISMO del vencimiento la membresía sigue activa (sigueVigente compara >=).
    const membresia = { ...base, tipoTarjeta: 'membresia', puntos: 0, selloMeta: null };
    expect(frentePase({ ...membresia, vigenciaHasta: '2026-09-09' }).listado!.valor).toBe(
      'Activa hasta el 9 de septiembre de 2026',
    );
    expect(frentePase({ ...membresia, vigenciaHasta: '2026-09-08' }).listado!.valor).toBe(
      'Vencida el 8 de septiembre de 2026',
    );
    expect(frentePase(membresia).listado).toEqual({ etiqueta: 'MEMBRESÍA', valor: 'Sin activar', numero: null });
  });

  it('cupón: disponible, con fecha, vencido y ya usado', () => {
    const cupon = { ...base, tipoTarjeta: 'cupon', puntos: 0, selloMeta: null };
    expect(frentePase(cupon).listado).toEqual({ etiqueta: 'CUPÓN', valor: 'Disponible', numero: null });
    expect(frentePase({ ...cupon, vigenciaHasta: '2026-09-30' }).listado!.valor).toBe(
      'Disponible hasta el 30 de septiembre de 2026',
    );
    expect(frentePase({ ...cupon, vigenciaHasta: '2026-08-03' }).listado!.valor).toBe('Venció el 3 de agosto de 2026');
    // `usadoEn` gana sobre la fecha: un cupón usado ya no está "disponible" aunque no haya vencido.
    expect(
      frentePase({ ...cupon, vigenciaHasta: '2026-09-30', usadoEn: '2026-09-05T15:00:00Z' }).listado,
    ).toEqual({ etiqueta: 'CUPÓN', valor: 'Ya usado', numero: null });
  });
});
