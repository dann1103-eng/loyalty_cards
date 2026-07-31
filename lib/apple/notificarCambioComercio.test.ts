import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from '../comercio/programas';
import { notificarCambioComercio, notificarCambioPrograma } from './notificarCambioComercio';

// notificarCambioTarjeta se mockea: lo que se prueba acá es A CUÁLES tarjetas se les manda el push,
// no el envío en sí (que tiene su propia prueba y hablaría con APNs).
const pushMock = vi.fn();
vi.mock('./notificarCambioTarjeta', () => ({
  notificarCambioTarjeta: (...args: unknown[]) => pushMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  pushMock.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await entorno.limpiar();
});

async function comercioConTarjetaEnCadaPrograma() {
  const comercioId = await entorno.crearComercio({});
  const principalId = entorno.obtenerProgramaPrincipal(comercioId);
  const res = await crearPrograma(supabase, comercioId, {
    nombre: 'Cupon de bienvenida',
    tipoTarjeta: 'cupon',
    cashbackPorcentaje: null,
    multipassVisitas: null,
    membresiaDias: null,
    cuponVigenciaDias: null,
  });
  if (!res.ok) throw new Error(res.error);

  const tarjetaPrincipal = await entorno.crearTarjeta(comercioId, 0, { programaId: principalId });
  const tarjetaCupon = await entorno.crearTarjeta(comercioId, 0, { programaId: res.id });
  return { comercioId, cuponId: res.id, tarjetaPrincipal, tarjetaCupon };
}

function tarjetasNotificadas(): string[] {
  return pushMock.mock.calls.map((c) => c[1] as string);
}

describe('notificarCambioComercio', () => {
  it('notifica a las tarjetas de TODOS los programas del comercio', async () => {
    const { comercioId, tarjetaPrincipal, tarjetaCupon } = await comercioConTarjetaEnCadaPrograma();

    await notificarCambioComercio(supabase, comercioId);

    expect(tarjetasNotificadas().sort()).toEqual([tarjetaPrincipal.id, tarjetaCupon.id].sort());
  });
});

describe('notificarCambioPrograma', () => {
  // Sin esto, cambiarle la marca a un programa no llega a NINGÚN iPhone: Wallet solo re-descarga el
  // .pkpass cuando recibe un push. Y acotarlo importa: un push al programa que no cambió hace que
  // ese cliente descargue de nuevo un pase idéntico.
  it('notifica SOLO a las tarjetas del programa indicado', async () => {
    const { comercioId, cuponId, tarjetaCupon } = await comercioConTarjetaEnCadaPrograma();

    await notificarCambioPrograma(supabase, comercioId, cuponId);

    expect(
      tarjetasNotificadas(),
      'solo la tarjeta del programa que cambió tiene que recibir el push',
    ).toEqual([tarjetaCupon.id]);
  });

  it('no notifica a las tarjetas de un programa de OTRO comercio aunque se conozca su id', async () => {
    const propio = await comercioConTarjetaEnCadaPrograma();
    const ajeno = await comercioConTarjetaEnCadaPrograma();

    await notificarCambioPrograma(supabase, propio.comercioId, ajeno.cuponId);

    expect(
      tarjetasNotificadas(),
      'un programa de otro comercio no puede disparar pushes',
    ).toEqual([]);
  });
});
