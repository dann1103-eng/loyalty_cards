import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { buscarTarjetaPorToken, acreditarPuntos } from './acreditar';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];
const sucursalesDePrueba: string[] = [];
const usuariosComercioDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: ledger (transacciones apunta a tarjetas/sucursales/usuarios_comercio) va primero;
  // luego usuarios_comercio y sucursales (apuntan a comercios; usuarios_comercio también a
  // sucursales, por eso va antes) → tarjetas → clientes/comercios.
  if (tarjetasDePrueba.length) {
    await supabase.from('transacciones_puntos').delete().in('tarjeta_id', tarjetasDePrueba);
  }
  if (usuariosComercioDePrueba.length) {
    const { error } = await supabase.from('usuarios_comercio').delete().in('id', usuariosComercioDePrueba);
    if (error) console.error('[test] no se pudieron borrar los cajeros:', error);
    usuariosComercioDePrueba.length = 0;
  }
  if (sucursalesDePrueba.length) {
    const { error } = await supabase.from('sucursales').delete().in('id', sucursalesDePrueba);
    if (error) console.error('[test] no se pudieron borrar las sucursales:', error);
    sucursalesDePrueba.length = 0;
  }
  if (tarjetasDePrueba.length) {
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas:', error);
    tarjetasDePrueba.length = 0;
  }
  if (clientesDePrueba.length) {
    const { error } = await supabase.from('clientes').delete().in('id', clientesDePrueba);
    if (error) console.error('[test] no se pudieron borrar los clientes:', error);
    clientesDePrueba.length = 0;
  }
  if (comerciosDePrueba.length) {
    const { error } = await supabase.from('comercios').delete().in('id', comerciosDePrueba);
    if (error) console.error('[test] no se pudieron borrar los comercios:', error);
    comerciosDePrueba.length = 0;
  }
});

async function crearComercio(): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Escáner', slug: `test-escaner-${sufijo}` })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearTarjeta(comercioId: string, puntos = 0): Promise<{ id: string; qrToken: string }> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: cliente, error: eC } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Escáner', telefono: `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}` })
    .select('id')
    .single();
  if (eC) throw eC;
  clientesDePrueba.push(cliente.id);
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: puntos, qr_token: `test-tok-${sufijo}` })
    .select('id, qr_token')
    .single();
  if (eT) throw eT;
  tarjetasDePrueba.push(tarjeta.id);
  return { id: tarjeta.id, qrToken: tarjeta.qr_token };
}

async function crearSucursal(comercioId: string, activa = true): Promise<string> {
  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre: 'Sucursal Prueba', activa })
    .select('id')
    .single();
  if (error) throw error;
  sucursalesDePrueba.push(data.id);
  return data.id;
}

// Cajero mínimo (usuarios_comercio) para el cajero_usuario_id del ledger: sin cuenta de Auth
// (auth_user_id nullable) — el RPC solo exige que la FK a usuarios_comercio(id) resuelva.
async function crearCajero(comercioId: string): Promise<string> {
  const email = `cajero-${Date.now()}-${Math.random().toString(36).slice(2)}@ejemplo.test`;
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email, rol: 'cajero' })
    .select('id')
    .single();
  if (error) throw error;
  usuariosComercioDePrueba.push(data.id);
  return data.id;
}

describe('buscarTarjetaPorToken', () => {
  it('encuentra la tarjeta por su token dentro del comercio', async () => {
    const comercioId = await crearComercio();
    const { id, qrToken } = await crearTarjeta(comercioId, 4);

    const res = await buscarTarjetaPorToken(supabase, comercioId, qrToken);

    expect(res).not.toBeNull();
    expect(res!.tarjetaId).toBe(id);
    expect(res!.puntosActuales).toBe(4);
    expect(res!.nombreCliente).toBe('Cliente Escáner');
  });

  it('devuelve null para el token de una tarjeta de OTRO comercio', async () => {
    // El escáner de un comercio NO debe resolver tarjetas ajenas: un QR de otro local se trata
    // igual que un token inexistente (sin filtrar información).
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const { qrToken } = await crearTarjeta(comercioA);

    expect(await buscarTarjetaPorToken(supabase, comercioB, qrToken)).toBeNull();
  });

  it('devuelve null para un token inexistente', async () => {
    const comercioId = await crearComercio();
    expect(await buscarTarjetaPorToken(supabase, comercioId, 'no-existe-para-nada')).toBeNull();
  });
});

describe('acreditarPuntos', () => {
  it('suma el delta, deja fila en el ledger y devuelve el nuevo saldo', async () => {
    const comercioId = await crearComercio();
    const { id } = await crearTarjeta(comercioId, 3);

    const res = await acreditarPuntos(supabase, comercioId, id, 2);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.puntosActuales).toBe(5);
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(5);
    // El ledger es la fuente de verdad de auditoría: sin fila, la acreditación no cuenta.
    const { data: ledger } = await supabase
      .from('transacciones_puntos')
      .select('puntos_delta')
      .eq('tarjeta_id', id);
    expect(ledger).toHaveLength(1);
    expect(ledger![0].puntos_delta).toBe(2);
  });

  it('rechaza deltas no positivos o no enteros sin tocar el saldo', async () => {
    const comercioId = await crearComercio();
    const { id } = await crearTarjeta(comercioId, 3);

    for (const delta of [0, -1, 1.5, NaN]) {
      const res = await acreditarPuntos(supabase, comercioId, id, delta);
      expect(res.ok).toBe(false);
    }
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(3);
  });

  it('NO acredita una tarjeta de OTRO comercio', async () => {
    // La rama de seguridad del escáner: un dueño no puede inflar tarjetas ajenas aunque conozca
    // el id. Sin el scope por comercio_id, esto acreditaría.
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const { id } = await crearTarjeta(comercioA, 3);

    const res = await acreditarPuntos(supabase, comercioB, id, 5);

    expect(res.ok).toBe(false);
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(3); // intacta
  });

  it('persiste sucursalId y cajeroUsuarioId en la fila del ledger', async () => {
    // Atribución (Fase 8): al acreditar con sucursal/cajero, la fila de transacciones_puntos debe
    // quedar con esos ids. Si el wrapper no reenvía las opciones al RPC, quedan null y esto FALLA.
    const comercioId = await crearComercio();
    const { id } = await crearTarjeta(comercioId, 0);
    const sucursalId = await crearSucursal(comercioId);
    const cajeroUsuarioId = await crearCajero(comercioId);

    const res = await acreditarPuntos(supabase, comercioId, id, 4, { sucursalId, cajeroUsuarioId });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.puntosActuales).toBe(4);
    const { data: ledger } = await supabase
      .from('transacciones_puntos')
      .select('sucursal_id, cajero_usuario_id, puntos_delta')
      .eq('tarjeta_id', id);
    expect(ledger).toHaveLength(1);
    expect(ledger![0].sucursal_id).toBe(sucursalId);
    expect(ledger![0].cajero_usuario_id).toBe(cajeroUsuarioId);
    expect(ledger![0].puntos_delta).toBe(4);
  });

  it('rechaza una sucursalId de OTRO comercio sin tocar el saldo ni el ledger', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const { id } = await crearTarjeta(comercioA, 3);
    const sucursalAjena = await crearSucursal(comercioB);

    const res = await acreditarPuntos(supabase, comercioA, id, 5, { sucursalId: sucursalAjena });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('La sucursal no es válida.');
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(3); // intacta: la sucursal inválida aborta antes de sumar
    const { data: ledger } = await supabase.from('transacciones_puntos').select('id').eq('tarjeta_id', id);
    expect(ledger).toHaveLength(0);
  });

  it('rechaza una sucursalId del MISMO comercio pero inactiva', async () => {
    const comercioId = await crearComercio();
    const { id } = await crearTarjeta(comercioId, 3);
    const sucursalInactiva = await crearSucursal(comercioId, false);

    const res = await acreditarPuntos(supabase, comercioId, id, 5, { sucursalId: sucursalInactiva });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('La sucursal no es válida.');
    const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', id).single();
    expect(data!.puntos_actuales).toBe(3); // intacta
  });
});
