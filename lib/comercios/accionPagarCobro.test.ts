import { afterEach, describe, expect, it } from 'vitest';
import type { DatosEnlace } from '../wompi/cliente';
import { createServiceClient } from '../supabase/server';
import { pagarCobroPedido } from './accionPagarCobro';
import { METODO_PEDIDO_FM } from './cobros';

// Contra Supabase (necesita .env.local; NO depende de la migración 0038). Wompi es falso: no se llama a
// ninguna API real, igual que iniciarPagoPlanSupabase.test.ts.

const supabase = createServiceClient();
const cuentas: string[] = [];

afterEach(async () => {
  if (cuentas.length) {
    await supabase.from('cobros').delete().in('cuenta_id', cuentas);
    await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
  }
});

const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function crearCuenta(): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Pagar Cobro ${sufijo()}` })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

async function crearCobro(cuentaId: string, campos: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await supabase
    .from('cobros')
    .insert({
      cuenta_id: cuentaId,
      tipo: 'periodo',
      periodo_desde: '2026-09-01',
      periodo_hasta: '2026-09-30',
      monto: 29,
      estado: 'pendiente',
      metodo: METODO_PEDIDO_FM,
      ...campos,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

function wompiFalso() {
  const enlaces: DatosEnlace[] = [];
  return {
    enlaces,
    wompi: {
      async crearEnlacePago(datos: DatosEnlace) {
        enlaces.push(datos);
        return {
          idEnlace: enlaces.length,
          urlEnlace: `https://lk.wompi.sv/pedido-${enlaces.length}`,
          urlEnlaceLargo: null,
          esProductivo: false,
        };
      },
    },
  };
}

function deps(wompi: ReturnType<typeof wompiFalso>['wompi'], ahora: () => Date = () => new Date()) {
  return { wompi, ahora, baseUrl: 'https://www.cardly-sv.site' };
}

describe('pagarCobroPedido', () => {
  it('sin enlace previo: crea uno nuevo y lo guarda en el cobro', async () => {
    const cuentaId = await crearCuenta();
    const cobroId = await crearCobro(cuentaId);
    const { wompi, enlaces } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, cobroId, deps(wompi));

    expect(r).toEqual({ ok: true, url: 'https://lk.wompi.sv/pedido-1' });
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0].identificador).toBe(cobroId);
    expect(enlaces[0].monto).toBe(29);
    const { data: cobro } = await supabase
      .from('cobros')
      .select('wompi_url_enlace, wompi_id_enlace, wompi_enlace_vence')
      .eq('id', cobroId)
      .single();
    expect(cobro!.wompi_url_enlace).toBe('https://lk.wompi.sv/pedido-1');
    expect(cobro!.wompi_id_enlace).toBe(1);
  });

  it('con un enlace VIGENTE: lo reusa sin llamar a Wompi de nuevo', async () => {
    const cuentaId = await crearCuenta();
    const venceEnUnaHora = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const cobroId = await crearCobro(cuentaId, {
      wompi_url_enlace: 'https://lk.wompi.sv/vigente',
      wompi_enlace_vence: venceEnUnaHora,
    });
    const { wompi, enlaces } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, cobroId, deps(wompi));

    expect(r).toEqual({ ok: true, url: 'https://lk.wompi.sv/vigente' });
    expect(enlaces).toHaveLength(0);
  });

  it('con un enlace VENCIDO: crea uno nuevo', async () => {
    const cuentaId = await crearCuenta();
    const vencidoHaceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const cobroId = await crearCobro(cuentaId, {
      wompi_url_enlace: 'https://lk.wompi.sv/vencido',
      wompi_enlace_vence: vencidoHaceUnaHora,
    });
    const { wompi, enlaces } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, cobroId, deps(wompi));

    expect(r).toEqual({ ok: true, url: 'https://lk.wompi.sv/pedido-1' });
    expect(enlaces).toHaveLength(1);
  });

  it('rechaza un cobro que NO es "Pedido por Cardly SV"', async () => {
    const cuentaId = await crearCuenta();
    const cobroId = await crearCobro(cuentaId, { metodo: 'Wompi' });
    const { wompi, enlaces } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, cobroId, deps(wompi));

    expect(r).toEqual({ ok: false, error: 'Ese cobro no es uno que Cardly SV te haya pedido.' });
    expect(enlaces).toHaveLength(0);
  });

  it('rechaza un cobro ya pagado', async () => {
    const cuentaId = await crearCuenta();
    const cobroId = await crearCobro(cuentaId, { estado: 'pagado', pagado_en: '2026-09-01' });
    const { wompi, enlaces } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, cobroId, deps(wompi));

    expect(r).toEqual({ ok: false, error: 'Ese cobro ya no está pendiente.' });
    expect(enlaces).toHaveLength(0);
  });

  it('rechaza un cobro de OTRA cuenta', async () => {
    const cuentaId = await crearCuenta();
    const otraCuentaId = await crearCuenta();
    const cobroId = await crearCobro(otraCuentaId);
    const { wompi, enlaces } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, cobroId, deps(wompi));

    expect(r).toEqual({ ok: false, error: 'No encontramos ese cobro en tu cuenta. Recargá la página.' });
    expect(enlaces).toHaveLength(0);
  });

  it('rechaza un cobro que no existe', async () => {
    const cuentaId = await crearCuenta();
    const { wompi } = wompiFalso();

    const r = await pagarCobroPedido(supabase, cuentaId, '00000000-0000-0000-0000-000000000000', deps(wompi));

    expect(r).toEqual({ ok: false, error: 'No encontramos ese cobro en tu cuenta. Recargá la página.' });
  });
});
