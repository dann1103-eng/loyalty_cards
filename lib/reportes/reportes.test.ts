import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { acreditarPuntos } from '../comercio/acreditar';
import { canjearRecompensa } from '../comercio/canje';
import {
  reporteSucursales,
  reporteTopClientes,
  reporteTendencia,
  reporteFmComercios,
} from './reportes';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const cuentasDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];
const sucursalesDePrueba: string[] = [];
const usuariosComercioDePrueba: string[] = [];

afterEach(async () => {
  // Orden FK: canjes/transacciones (→ tarjetas/sucursales/usuarios_comercio) primero; luego
  // usuarios_comercio y sucursales (→ comercios; usuarios_comercio también → sucursales, por eso va
  // antes) → tarjetas → recompensas → clientes → comercios → cuentas (comercios.cuenta_id → cuentas,
  // así que los comercios se borran antes que sus cuentas).
  if (tarjetasDePrueba.length) {
    await supabase.from('canjes').delete().in('tarjeta_id', tarjetasDePrueba);
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
  if (comerciosDePrueba.length) {
    await supabase.from('recompensas').delete().in('comercio_id', comerciosDePrueba);
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
  if (cuentasDePrueba.length) {
    const { error } = await supabase.from('cuentas_comercio').delete().in('id', cuentasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las cuentas:', error);
    cuentasDePrueba.length = 0;
  }
});

function sufijo(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function crearCuenta(nombre: string): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre })
    .select('id')
    .single();
  if (error) throw error;
  cuentasDePrueba.push(data.id);
  return data.id;
}

async function crearComercio(cuentaId?: string): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Reportes', slug: `test-reportes-${sufijo()}`, cuenta_id: cuentaId ?? null })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearTarjeta(comercioId: string, puntos = 0): Promise<string> {
  const { data: cliente, error: eC } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Reportes', telefono: `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}` })
    .select('id')
    .single();
  if (eC) throw eC;
  clientesDePrueba.push(cliente.id);
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: puntos, qr_token: `test-rep-${sufijo()}` })
    .select('id')
    .single();
  if (eT) throw eT;
  tarjetasDePrueba.push(tarjeta.id);
  return tarjeta.id;
}

async function crearSucursal(comercioId: string, nombre: string, activa = true): Promise<string> {
  const { data, error } = await supabase
    .from('sucursales')
    .insert({ comercio_id: comercioId, nombre, activa })
    .select('id')
    .single();
  if (error) throw error;
  sucursalesDePrueba.push(data.id);
  return data.id;
}

async function crearRecompensa(comercioId: string, costo: number): Promise<string> {
  const { data, error } = await supabase
    .from('recompensas')
    .insert({ comercio_id: comercioId, nombre: 'Café gratis', costo_puntos: costo, tipo: 'articulo_gratis', activa: true })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

// Cajero mínimo (usuarios_comercio) para el cajero_usuario_id del ledger: sin cuenta de Auth.
async function crearCajero(comercioId: string): Promise<string> {
  const email = `cajero-${sufijo()}@ejemplo.test`;
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email, rol: 'cajero' })
    .select('id')
    .single();
  if (error) throw error;
  usuariosComercioDePrueba.push(data.id);
  return data.id;
}

describe('reporteSucursales', () => {
  it('agrega acreditaciones, puntos, canjes y clientes únicos por sucursal + bucket NULL', async () => {
    // Comercio QA con dos sucursales atribuidas y un bucket de actividad SIN sucursal.
    const comercioId = await crearComercio();
    const sucA = await crearSucursal(comercioId, 'Sucursal A');
    const sucB = await crearSucursal(comercioId, 'Sucursal B');
    const cajero = await crearCajero(comercioId);
    const t1 = await crearTarjeta(comercioId, 0);
    const t2 = await crearTarjeta(comercioId, 0);
    const recompensa = await crearRecompensa(comercioId, 3);

    // Sucursal A: dos acreditaciones (t1:10, t2:3 = 13 puntos, 2 clientes únicos) y un canje (t1).
    expect((await acreditarPuntos(supabase, comercioId, t1, 10, { sucursalId: sucA, cajeroUsuarioId: cajero })).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, t2, 3, { sucursalId: sucA, cajeroUsuarioId: cajero })).ok).toBe(true);
    // Sucursal B: una acreditación (t1:5, 1 cliente único), sin canjes.
    expect((await acreditarPuntos(supabase, comercioId, t1, 5, { sucursalId: sucB, cajeroUsuarioId: cajero })).ok).toBe(true);
    // Canje en A (t1 tiene 15 puntos; cuesta 3).
    expect((await canjearRecompensa(supabase, comercioId, t1, recompensa, { sucursalId: sucA, cajeroUsuarioId: cajero })).ok).toBe(true);
    // Bucket NULL: transacción SIN sucursal (t2, delta 4). Insert directo (el escáner ya no permite null,
    // pero la BD conserva filas históricas previas a la atribución de la Fase 8).
    const { error: eNull } = await supabase
      .from('transacciones_puntos')
      .insert({ tarjeta_id: t2, puntos_delta: 4, sucursal_id: null });
    if (eNull) throw eNull;

    const filas = await reporteSucursales(supabase, comercioId);

    // Orden esperado: A, B (por nombre), y el bucket NULL al final.
    expect(filas).toHaveLength(3);

    const a = filas.find((f) => f.sucursal_id === sucA)!;
    expect(a.sucursal_nombre).toBe('Sucursal A');
    expect(a.sucursal_activa).toBe(true);
    expect(a.acreditaciones).toBe(2);
    expect(a.puntos_otorgados).toBe(13);
    expect(a.canjes).toBe(1);
    expect(a.clientes_unicos).toBe(2);

    const b = filas.find((f) => f.sucursal_id === sucB)!;
    expect(b.sucursal_nombre).toBe('Sucursal B');
    expect(b.acreditaciones).toBe(1);
    expect(b.puntos_otorgados).toBe(5);
    expect(b.canjes).toBe(0);
    expect(b.clientes_unicos).toBe(1);

    const sinSucursal = filas.find((f) => f.sucursal_id === null)!;
    expect(sinSucursal.sucursal_nombre).toBeNull();
    expect(sinSucursal.acreditaciones).toBe(1);
    expect(sinSucursal.puntos_otorgados).toBe(4);
    expect(sinSucursal.canjes).toBe(0);
    expect(sinSucursal.clientes_unicos).toBe(1);

    // El bucket NULL debe quedar de último (order by sid is null).
    expect(filas[filas.length - 1].sucursal_id).toBeNull();
  });

  it('devuelve [] para un comercio sin actividad', async () => {
    const comercioId = await crearComercio();
    expect(await reporteSucursales(supabase, comercioId)).toEqual([]);
  });

  it('NO mezcla la actividad de otro comercio', async () => {
    // Scope por comercio_id: la actividad de un comercio ajeno no debe aparecer en el reporte.
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    const sucA = await crearSucursal(comercioA, 'Sucursal A');
    const tA = await crearTarjeta(comercioA, 0);
    const tB = await crearTarjeta(comercioB, 0);
    expect((await acreditarPuntos(supabase, comercioA, tA, 7, { sucursalId: sucA })).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioB, tB, 99)).ok).toBe(true);

    const filas = await reporteSucursales(supabase, comercioA);

    expect(filas).toHaveLength(1);
    expect(filas[0].sucursal_id).toBe(sucA);
    expect(filas[0].puntos_otorgados).toBe(7); // 7, no 106 — la fila de B (99) queda fuera
  });
});

describe('reporteTopClientes', () => {
  it('ordena por visitas y desempata por puntos, respetando el límite', async () => {
    const comercioId = await crearComercio();
    const t1 = await crearTarjeta(comercioId, 0);
    const t2 = await crearTarjeta(comercioId, 0);
    const t3 = await crearTarjeta(comercioId, 0);
    // t1: 3 visitas / 30 pts. t2: 2 visitas / 20 pts. t3: 1 visita / 5 pts.
    for (const d of [10, 10, 10]) expect((await acreditarPuntos(supabase, comercioId, t1, d)).ok).toBe(true);
    for (const d of [10, 10]) expect((await acreditarPuntos(supabase, comercioId, t2, d)).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, t3, 5)).ok).toBe(true);

    const top = await reporteTopClientes(supabase, comercioId, 2);

    // El límite recorta a los 2 primeros; t3 queda fuera.
    expect(top).toHaveLength(2);
    expect(top[0].visitas).toBe(3);
    expect(top[0].puntos_totales).toBe(30);
    expect(top[1].visitas).toBe(2);
    expect(top[1].puntos_totales).toBe(20);
  });
});

describe('reporteTendencia', () => {
  it('devuelve una serie de N días que suma la actividad sembrada (con días en 0)', async () => {
    const comercioId = await crearComercio();
    const t1 = await crearTarjeta(comercioId, 0);
    const recompensa = await crearRecompensa(comercioId, 3);
    // Dos acreditaciones y un canje hoy (created_at por defecto = now()).
    expect((await acreditarPuntos(supabase, comercioId, t1, 5)).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, t1, 5)).ok).toBe(true);
    expect((await canjearRecompensa(supabase, comercioId, t1, recompensa)).ok).toBe(true);

    const dias = 7;
    const serie = await reporteTendencia(supabase, comercioId, dias);

    // La serie cubre exactamente N días, ordenada, e incluye días en 0 (zero-fill).
    expect(serie).toHaveLength(dias);
    const totalAcred = serie.reduce((s, r) => s + r.acreditaciones, 0);
    const totalCanjes = serie.reduce((s, r) => s + r.canjes, 0);
    expect(totalAcred).toBe(2);
    expect(totalCanjes).toBe(1);
    // El último día de la serie es hoy y concentra la actividad recién sembrada.
    expect(serie[serie.length - 1].acreditaciones).toBe(2);
    expect(serie[serie.length - 1].canjes).toBe(1);
  });
});

describe('reporteFmComercios', () => {
  it('agrega por comercio con su cuenta, clientes, movimientos y saldo circulante', async () => {
    const cuentaId = await crearCuenta(`Cuenta QA ${sufijo()}`);
    const comercioId = await crearComercio(cuentaId);
    const t1 = await crearTarjeta(comercioId, 0);
    const t2 = await crearTarjeta(comercioId, 0);
    const recompensa = await crearRecompensa(comercioId, 3);
    // t1: acredita 10 y canjea 3 → saldo 7. t2: acredita 4 → saldo 4. Circulante total = 11.
    expect((await acreditarPuntos(supabase, comercioId, t1, 10)).ok).toBe(true);
    expect((await acreditarPuntos(supabase, comercioId, t2, 4)).ok).toBe(true);
    expect((await canjearRecompensa(supabase, comercioId, t1, recompensa)).ok).toBe(true);

    const filas = await reporteFmComercios(supabase);
    const fila = filas.find((f) => f.comercio_id === comercioId)!;

    expect(fila).toBeDefined();
    expect(fila.cuenta_id).toBe(cuentaId);
    expect(fila.cuenta_nombre).toContain('Cuenta QA');
    expect(fila.clientes).toBe(2); // dos tarjetas
    expect(fila.acreditaciones).toBe(2); // dos filas en transacciones_puntos
    expect(fila.canjes).toBe(1);
    expect(fila.saldo_circulante).toBe(11); // 7 + 4
  });
});
