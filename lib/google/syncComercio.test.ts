import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from '../comercio/programas';
import { syncObjetosComercio, syncObjetosPrograma } from './syncComercio';

// syncObjetoTarjeta se mockea: lo que se prueba acá es A CUÁLES tarjetas se llama, no lo que la
// sincronización le manda a Google. Google además no se toca nunca desde las pruebas (CLAUDE.md).
const syncMock = vi.fn();
vi.mock('./syncObjeto', () => ({
  syncObjetoTarjeta: (...args: unknown[]) => syncMock(...args),
}));

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

beforeEach(() => {
  syncMock.mockReset().mockResolvedValue({ ok: true, objectId: 'obj-test' });
});

afterEach(async () => {
  await entorno.limpiar();
});

// Un comercio con dos programas y una tarjeta en cada uno: el caso que hace falta para distinguir
// "re-sincronicé el comercio entero" de "re-sincronicé solo el programa que cambió".
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

function tarjetasSincronizadas(): string[] {
  return syncMock.mock.calls.map((c) => c[1] as string);
}

describe('syncObjetosComercio', () => {
  it('re-sincroniza las tarjetas de TODOS los programas del comercio', async () => {
    const { comercioId, tarjetaPrincipal, tarjetaCupon } = await comercioConTarjetaEnCadaPrograma();

    await syncObjetosComercio(supabase, comercioId);

    expect(tarjetasSincronizadas().sort()).toEqual([tarjetaPrincipal.id, tarjetaCupon.id].sort());
  });
});

describe('syncObjetosPrograma', () => {
  // Sin acotar, cambiarle la marca al cupón re-sincronizaría también las tarjetas del programa
  // principal: Google re-descargaría la grilla de clientes que no cambiaron de aspecto — una
  // llamada por tarjeta a la API, por nada.
  it('re-sincroniza SOLO las tarjetas del programa indicado', async () => {
    const { comercioId, cuponId, tarjetaCupon } = await comercioConTarjetaEnCadaPrograma();

    await syncObjetosPrograma(supabase, comercioId, cuponId);

    expect(
      tarjetasSincronizadas(),
      'solo la tarjeta del programa que cambió tiene que re-sincronizarse',
    ).toEqual([tarjetaCupon.id]);
  });

  // El programaId viaja en el formulario del dueño; el comercioId viene del gate. Sin el scope por
  // comercio, un id de programa ajeno dispararía escrituras a Google sobre tarjetas de otro negocio.
  it('no toca las tarjetas de un programa de OTRO comercio aunque se conozca su id', async () => {
    const propio = await comercioConTarjetaEnCadaPrograma();
    const ajeno = await comercioConTarjetaEnCadaPrograma();

    await syncObjetosPrograma(supabase, propio.comercioId, ajeno.cuponId);

    expect(
      tarjetasSincronizadas(),
      'un programa de otro comercio no puede disparar sincronizaciones',
    ).toEqual([]);
  });
});
