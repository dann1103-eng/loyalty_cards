// El cuerpo del webhook de Wompi. La doc lo ejemplifica con un JSON de 2020 (nombres en PascalCase) y
// el Swagger no lo describe, así que este parser es TOLERANTE: busca cada campo sin distinguir
// mayúsculas y acepta números o textos donde la doc podría haber cambiado. Lo que no reconoce lo
// RECHAZA con un motivo, y quien llama guarda el cuerpo crudo de todos modos: un pago con un formato
// inesperado tiene que quedar visible en /admin/pagos, no perderse.

export interface PagoWebhook {
  idTransaccion: string;
  monto: number;
  esProductiva: boolean;
  // 'ExitosaAprobada' | 'ExitosaDeclinada' | 'Fallida' | ... | null si el cuerpo no lo trae.
  resultado: string | null;
  formaPago: string | null;
  // ISO 8601, o null si el cuerpo no trae una fecha legible.
  fecha: string | null;
  // Lo que la app mandó al crear el enlace (el id del cobro), o el de un enlace hecho a mano en el panel.
  identificadorEnlace: string | null;
  idEnlace: number | null;
}

export type ResultadoParseo = { ok: true; pago: PagoWebhook } | { ok: false; motivo: string };

const RESULTADOS_NUMERICOS: Record<number, string> = {
  0: 'ExitosaAprobada',
  1: 'ExitosaDeclinada',
  2: 'Fallida',
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function buscar(objeto: unknown, nombre: string): unknown {
  if (!esObjeto(objeto)) return undefined;
  const clave = Object.keys(objeto).find((k) => k.toLowerCase() === nombre.toLowerCase());
  return clave === undefined ? undefined : objeto[clave];
}

function texto(valor: unknown): string | null {
  if (typeof valor === 'string') return valor.trim() || null;
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  return null;
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function booleano(valor: unknown): boolean | null {
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'string') {
    const v = valor.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

function fechaIso(valor: unknown): string | null {
  const t = texto(valor);
  if (t === null) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

// Los bytes del cuerpo a texto para JSON.parse: UTF-8, sin el BOM inicial (JSON.parse lo rechaza).
// La FIRMA se calcula sobre los bytes originales, nunca sobre este texto.
export function decodificarCuerpo(bytes: Uint8Array): string {
  const t = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
}

export function parsearWebhook(cuerpo: unknown): ResultadoParseo {
  if (!esObjeto(cuerpo)) return { ok: false, motivo: 'el cuerpo no es un objeto JSON' };

  const idTransaccion = texto(buscar(cuerpo, 'IdTransaccion'));
  if (idTransaccion === null) return { ok: false, motivo: 'falta IdTransaccion' };

  const monto = numero(buscar(cuerpo, 'Monto'));
  if (monto === null || monto < 0) return { ok: false, motivo: 'Monto ausente o inválido' };

  // Sin EsProductiva no se sabe si la plata es real: se rechaza para que el pago quede visible, en
  // vez de asumir un valor que activaría (o ignoraría) una cuenta por una suposición.
  const esProductiva = booleano(buscar(cuerpo, 'EsProductiva'));
  if (esProductiva === null) return { ok: false, motivo: 'falta EsProductiva' };

  const bruto = buscar(cuerpo, 'ResultadoTransaccion');
  const resultado = typeof bruto === 'number' ? (RESULTADOS_NUMERICOS[bruto] ?? String(bruto)) : texto(bruto);

  const enlace = buscar(cuerpo, 'EnlacePago');

  return {
    ok: true,
    pago: {
      idTransaccion,
      monto,
      esProductiva,
      resultado,
      formaPago: texto(buscar(cuerpo, 'FormaPagoUtilizada')),
      fecha: fechaIso(buscar(cuerpo, 'FechaTransaccion')),
      identificadorEnlace: texto(buscar(enlace, 'IdentificadorEnlaceComercio')),
      idEnlace: numero(buscar(enlace, 'Id')),
    },
  };
}

// ¿Wompi informa la transacción como aprobada? Un cuerpo sin resultado se da por aprobado: la doc dice
// que el webhook solo se manda para transacciones exitosas.
export function estaAprobado(pago: PagoWebhook): boolean {
  return pago.resultado === null || pago.resultado === 'ExitosaAprobada';
}
