import type { ClienteWompi } from '../wompi/cliente';
import { calcularOpcionesPago, type AccionPago, type CuentaParaPagos } from './opcionesPago';
import { aCentavos } from './prorrateo';

// Iniciar un pago del plan: valida lo que el dueño pidió contra las opciones que el SERVIDOR calcula,
// crea (o reusa) el cobro pendiente, y le pide a Wompi el enlace de pago (spec 2026-09-21-pasarela-wompi-
// design.md, "Flujo" y "Cuánto se cobra").
//
// El dueño manda SOLO el plan y la acción. El importe, el período y la nota salen de `opcionesPago.ts`:
// aceptar un monto del navegador dejaría que cualquiera pagara $0.01 por un plan de $89.
//
// Las dependencias entran por parámetro (repositorio, cliente de Wompi, reloj) para probar todo sin base
// de datos ni red. `iniciarPagoPlanSupabase.ts` arma las reales.

// El enlace vence a las 2 horas. Un enlace no se puede desactivar desde la app (pide la contraseña de la
// cuenta Wompi), así que la vigencia corta es lo que acota dos fugas: pagar un enlace de un intento que ya
// se anuló, y pagar cuando el precio ya no corresponde. Un ajuste solo se ofrece con más de 7 días de
// período por delante, así que 2 horas nunca cruzan el fin del período.
export const VIGENCIA_ENLACE_MS = 2 * 60 * 60 * 1000;

export interface IntentoAbierto {
  cobroId: string;
  tipo: 'periodo' | 'ajuste';
  planDestino: string | null;
  monto: number;
  periodoDesde: string;
  creadoEn: string;
  enlaceUrl: string | null;
  enlaceVence: string | null;
}

export type ResultadoCrearCobro =
  | { ok: true; id: string }
  // `intentoAbierto`: la base rechazó el cobro porque ya hay uno pendiente de la app (el índice único
  // parcial): dos toques a la vez o dos pestañas.
  | { ok: false; error: string; intentoAbierto?: boolean };

export interface RepositorioIniciarPago {
  cargarCuenta(cuentaId: string): Promise<CuentaParaPagos | null>;
  intentoAbierto(cuentaId: string): Promise<IntentoAbierto | null>;
  // Anula SOLO los cobros pendientes que creó la app (metodo = 'Wompi'), nunca los que registró FM.
  anularIntentos(cuentaId: string): Promise<void>;
  crearCobro(
    cuentaId: string,
    datos: {
      tipo: 'periodo' | 'ajuste';
      periodoDesde: string;
      periodoHasta: string;
      monto: number;
      planDestino: string;
      nota: string | null;
    },
  ): Promise<ResultadoCrearCobro>;
  guardarEnlace(cobroId: string, enlace: { idEnlace: number; url: string; vence: string }): Promise<void>;
  anularCobro(cobroId: string): Promise<void>;
}

export interface DepsIniciarPago {
  repo: RepositorioIniciarPago;
  wompi: Pick<ClienteWompi, 'crearEnlacePago'>;
  ahora: () => Date;
  // La fecha de calendario de un instante, en la zona del negocio (`hoyEnZona`, de tarjetas/vigencia.ts).
  fechaDe: (instante: Date) => string;
  // `https://www.cardly-sv.site`, sin barra final.
  baseUrl: string;
}

export interface EntradaIniciarPago {
  cuentaId: string;
  plan: string;
  accion: AccionPago;
}

export type ResultadoIniciarPago = { ok: true; url: string } | { ok: false; error: string };

const ERROR_ENLACE = 'No pudimos generar el enlace de pago. Probá de nuevo en un rato.';

export async function iniciarPagoPlan(
  deps: DepsIniciarPago,
  entrada: EntradaIniciarPago,
): Promise<ResultadoIniciarPago> {
  const { repo } = deps;
  const ahora = deps.ahora();
  const hoy = deps.fechaDe(ahora);

  const cuenta = await repo.cargarCuenta(entrada.cuentaId);
  if (cuenta === null) return { ok: false, error: 'No se pudo leer tu cuenta.' };

  const calculo = calcularOpcionesPago(cuenta, hoy);
  const opcion = calculo.opciones.find((o) => o.plan === entrada.plan && o.accion === entrada.accion);
  if (opcion === undefined) {
    return { ok: false, error: calculo.aviso ?? 'Esa opción no está disponible ahora. Recargá la página.' };
  }
  if (opcion.bloqueadaPor !== null) return { ok: false, error: opcion.bloqueadaPor };

  // Un solo intento abierto por cuenta. Si el que hay es EXACTAMENTE esta opción, hecha hoy y con el
  // enlace todavía vigente, se sigue con ese; si no, se anula y se crea uno nuevo.
  const abierto = await repo.intentoAbierto(entrada.cuentaId);
  if (abierto !== null) {
    const esLaMisma =
      abierto.tipo === opcion.tipo &&
      abierto.planDestino === opcion.plan &&
      aCentavos(abierto.monto) === aCentavos(opcion.monto) &&
      abierto.periodoDesde === opcion.periodoDesde;
    const esDeHoy = deps.fechaDe(new Date(abierto.creadoEn)) === hoy;
    const vigente = abierto.enlaceVence !== null && new Date(abierto.enlaceVence).getTime() > ahora.getTime();
    if (esLaMisma && esDeHoy && vigente && abierto.enlaceUrl !== null) {
      return { ok: true, url: abierto.enlaceUrl };
    }
    await repo.anularIntentos(entrada.cuentaId);
  }

  const cobro = await repo.crearCobro(entrada.cuentaId, {
    tipo: opcion.tipo,
    periodoDesde: opcion.periodoDesde,
    periodoHasta: opcion.periodoHasta,
    monto: opcion.monto,
    planDestino: opcion.plan,
    nota: opcion.nota,
  });
  if (!cobro.ok) {
    return {
      ok: false,
      error: cobro.intentoAbierto ? 'Ya tenés un pago en curso. Recargá la página.' : cobro.error,
    };
  }

  const venceEn = new Date(ahora.getTime() + VIGENCIA_ENLACE_MS);
  const producto =
    opcion.tipo === 'ajuste'
      ? `Cardly SV · Ajuste al plan ${opcion.etiquetaPlan}`
      : `Cardly SV · Plan ${opcion.etiquetaPlan} (${opcion.periodoDesde} al ${opcion.periodoHasta})`;

  try {
    const enlace = await deps.wompi.crearEnlacePago({
      identificador: cobro.id,
      monto: opcion.monto,
      nombreProducto: producto,
      descripcion: opcion.nota ?? `Mensualidad del plan ${opcion.etiquetaPlan}`,
      urlRedirect: `${deps.baseUrl}/comercio/plan/pago/resultado`,
      urlRetorno: `${deps.baseUrl}/comercio/plan`,
      urlWebhook: `${deps.baseUrl}/api/wompi/webhook`,
      ahora,
      venceEn,
      datosAdicionales: { cobro: cobro.id, cuenta: entrada.cuentaId },
    });
    await repo.guardarEnlace(cobro.id, { idEnlace: enlace.idEnlace, url: enlace.urlEnlace, vence: venceEn.toISOString() });
    return { ok: true, url: enlace.urlEnlace };
  } catch (error) {
    // Sin enlace el cobro no sirve: se anula para no dejarle al dueño un "pago pendiente" fantasma, y
    // para liberar el lugar del único intento abierto.
    console.error('[wompi] no se pudo crear el enlace de pago:', error);
    await repo.anularCobro(cobro.id).catch((e: unknown) => console.error('[wompi] no se pudo anular el cobro huérfano:', e));
    return { ok: false, error: ERROR_ENLACE };
  }
}
