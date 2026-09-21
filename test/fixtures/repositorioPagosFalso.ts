import type {
  CobroParaPago,
  Conciliacion,
  EventoPago,
  NuevoEvento,
  RepositorioPagos,
  ResultadoAplicarPlan,
} from '@/lib/comercios/confirmarPago';

// Repositorio de pagos EN MEMORIA, para probar `confirmarPagoCobro` y todo lo que cuelga de él sin base
// de datos.
//
// ══ ES UN ESPEJO, Y UN ESPEJO QUE NADA OBLIGA A SINCRONIZAR VUELVE DECORATIVA LA SUITE ══ Su contrato es
// el de `repositorioPagosSupabase.ts`, y esa semántica tiene que ser IDÉNTICA:
//   - `registrarEvento` es idempotente por `idTransaccion` y devuelve la conciliación que ya tenía.
//   - `reclamarCobro` es ATÓMICO y CONDICIONAL: pasa a pagado solo si el estado está entre los
//     permitidos, y devuelve el cobro tal como quedó (o como está, si no lo reclamó). En la base es una
//     sola sentencia `update … where estado in (…) returning`; acá, una función síncrona, que en JS no
//     se interrumpe a la mitad.
//   - `actualizarEvento` no toca un campo que viene `undefined`.
// El adaptador real se prueba contra Supabase (repositorioPagosSupabase.test.ts) con los MISMOS casos.

export interface Fallos {
  // Cuántas veces la operación lanza antes de funcionar.
  aplicarPlan?: number;
  reclamarCobro?: number;
  // Falla al guardar una conciliación FINAL (no la de `error`), para probar reintentos a medias.
  actualizarEventoFinal?: number;
}

interface EventoGuardado extends EventoPago {
  idTransaccion: string;
  detalle: string | null;
  cobroId: string | null;
  cuentaId: string | null;
  payload: unknown;
}

export class RepositorioPagosFalso implements RepositorioPagos {
  cobros = new Map<string, CobroParaPago>();
  eventos = new Map<string, EventoGuardado>();
  planesAplicados: Array<{ cuentaId: string; plan: string; tipo: string }> = [];
  licencias: string[] = [];
  llamadas: string[] = [];
  consultasDeCobro: string[] = [];
  resultadoPlan: ResultadoAplicarPlan = { ok: true, cambio: true };

  private fallos: Fallos;
  private contador = 0;

  constructor(cobro: CobroParaPago | null = null, fallos: Fallos = {}) {
    if (cobro) this.cobros.set(cobro.id, { ...cobro });
    this.fallos = { ...fallos };
  }

  async obtenerCobro(id: string): Promise<CobroParaPago | null> {
    this.consultasDeCobro.push(id);
    const c = this.cobros.get(id);
    return c ? { ...c } : null;
  }

  async registrarEvento(nuevo: NuevoEvento): Promise<EventoPago> {
    const previo = [...this.eventos.values()].find((e) => e.idTransaccion === nuevo.idTransaccion);
    if (previo) return { id: previo.id, conciliacion: previo.conciliacion };
    const id = `evento-${++this.contador}`;
    const conciliacion = nuevo.conciliacion ?? 'pendiente';
    this.eventos.set(id, {
      id,
      idTransaccion: nuevo.idTransaccion,
      conciliacion,
      detalle: nuevo.detalle ?? null,
      cobroId: null,
      cuentaId: null,
      payload: nuevo.payload,
    });
    return { id, conciliacion };
  }

  async actualizarEvento(
    id: string,
    cambios: { conciliacion: Conciliacion; detalle?: string | null; cobroId?: string | null; cuentaId?: string | null },
  ): Promise<void> {
    if (cambios.conciliacion !== 'error' && (this.fallos.actualizarEventoFinal ?? 0) > 0) {
      this.fallos.actualizarEventoFinal! -= 1;
      throw new Error('se cayó la base al guardar el resultado');
    }
    const e = this.eventos.get(id)!;
    e.conciliacion = cambios.conciliacion;
    if (cambios.detalle !== undefined) e.detalle = cambios.detalle;
    if (cambios.cobroId !== undefined) e.cobroId = cambios.cobroId;
    if (cambios.cuentaId !== undefined) e.cuentaId = cambios.cuentaId;
  }

  async aplicarPlan(cuentaId: string, plan: string, tipo: 'periodo' | 'ajuste'): Promise<ResultadoAplicarPlan> {
    this.llamadas.push('aplicarPlan');
    if ((this.fallos.aplicarPlan ?? 0) > 0) {
      this.fallos.aplicarPlan! -= 1;
      throw new Error('se cayó la base al aplicar el plan');
    }
    this.planesAplicados.push({ cuentaId, plan, tipo });
    return this.resultadoPlan;
  }

  async activarLicencia(cuentaId: string): Promise<void> {
    this.licencias.push(cuentaId);
  }

  async reclamarCobro(
    cobroId: string,
    datos: { hoy: string; idTransaccion: string; estadosPermitidos: string[] },
  ): Promise<{ reclamado: boolean; cobro: CobroParaPago | null }> {
    this.llamadas.push('reclamarCobro');
    if ((this.fallos.reclamarCobro ?? 0) > 0) {
      this.fallos.reclamarCobro! -= 1;
      throw new Error('se cayó la base al reclamar el cobro');
    }
    const c = this.cobros.get(cobroId);
    if (!c) return { reclamado: false, cobro: null };
    if (!datos.estadosPermitidos.includes(c.estado)) return { reclamado: false, cobro: { ...c } };
    c.estado = 'pagado';
    c.wompiIdTransaccion = datos.idTransaccion;
    return { reclamado: true, cobro: { ...c } };
  }

  // Ayuda de las pruebas.
  conciliaciones(): Conciliacion[] {
    return [...this.eventos.values()].map((e) => e.conciliacion);
  }
}
