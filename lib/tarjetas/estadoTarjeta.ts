import { describirSaldo, nivelParaAcumulado, tipoOPuntos } from './tipos';

// El PEGAMENTO entre una fila de `tarjetas` y el formateador que sabe leerla.
//
// `describirSaldo` (tipos.ts) ya sabe decir bien los ocho tipos, pero necesita CUATRO datos de la
// tarjeta: el contador, la fecha de vigencia, cuándo se usó y el acumulado. El bug que este módulo
// cierra no estaba en el formateador sino en las consultas: cuatro pantallas traían solo
// `puntos_actuales` y llamaban a `formatearSaldo`, una función cuya firma NO PODÍA expresar los
// otros seis tipos — así que le mostraba al dueño y al cliente:
//
//   gift card de $25.00        → "2500 puntos"
//   cupón vencido              → "0 puntos"
//   membresía activa hasta ... → "0 puntos"
//   descuento de nivel 10%     → "0 puntos"
//
// La lección (misma que la del pase el 2026-07-30): un formateador correcto no sirve de nada si
// quien lo llama no le trae los campos. Por eso acá viajan JUNTAS la lista de columnas y la función
// que las lee — pedir una sin la otra deja de ser posible.

// Las columnas de `tarjetas` que necesita CUALQUIER pantalla que muestre un saldo. Se exporta como
// constante para que un `select` no pueda quedarse corto sin que se note.
export const COLUMNAS_ESTADO = 'puntos_actuales, vigencia_hasta, usado_en, acumulado_centavos';

export interface FilaEstado {
  puntos_actuales: number;
  vigencia_hasta: string | null;
  usado_en: string | null;
  // bigint en Postgres: según el driver puede llegar como string. Se normaliza acá adentro.
  acumulado_centavos: number | string | null;
}

export interface NivelDeDescuento {
  desdeCentavos: number;
  porcentaje: number;
}

// El saldo de UNA tarjeta, en el idioma de su tipo. `niveles` solo se usa en 'descuento'; pasarle
// [] en el resto es correcto y barato.
export function describirFila(
  fila: FilaEstado,
  tipoTarjeta: string,
  selloMeta: number | null,
  niveles: NivelDeDescuento[],
  hoyIso: string,
): string {
  const tipo = tipoOPuntos(tipoTarjeta);
  // El nivel se calcula al LEER, nunca se guarda: cambiar los umbrales tiene que reordenar a todos
  // los clientes de inmediato (ver lib/tarjetas/descuento.ts).
  const porcentajeDescuento =
    tipo.valor === 'descuento' ? nivelParaAcumulado(Number(fila.acumulado_centavos ?? 0), niveles) : null;

  return describirSaldo(
    {
      tipo: tipo.valor,
      contador: fila.puntos_actuales,
      selloMeta,
      vigenciaHasta: fila.vigencia_hasta,
      usadoEn: fila.usado_en,
      porcentajeDescuento,
    },
    hoyIso,
  );
}
