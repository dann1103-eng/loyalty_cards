import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { buscarTarjetasPorTelefono, formatearSaldo } from './buscarTarjetas';

const supabase = createServiceClient();
const comerciosDePrueba: string[] = [];
const clientesDePrueba: string[] = [];
const tarjetasDePrueba: string[] = [];

afterEach(async () => {
  // Orden: hijos antes que padres. tarjetas -> (clientes, comercios); recompensas -> comercios.
  if (tarjetasDePrueba.length) {
    const { error } = await supabase.from('tarjetas').delete().in('id', tarjetasDePrueba);
    if (error) console.error('[test] no se pudieron borrar las tarjetas:', error);
    tarjetasDePrueba.length = 0;
  }
  if (comerciosDePrueba.length) {
    const { error: eR } = await supabase.from('recompensas').delete().in('comercio_id', comerciosDePrueba);
    if (eR) console.error('[test] no se pudieron borrar las recompensas:', eR);
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

// Corregido tras revisión de plan: el fixture original de teléfono ("+000-portal-<timestamp>-
// <random36>") no sobrevive normalizarTelefono() — al despojar lo no-numérico, "000" + los 13
// dígitos de Date.now() YA suman 16, por encima del máximo E.164 de 15 que la función rechaza.
// Con buscarTarjetasPorTelefono() normalizando de verdad (el fix de esa misma revisión), esos
// fixtures habrían hecho que TODAS las pruebas "felices" fallaran al no encontrar lo que acaban
// de insertar. Este helper genera un teléfono único que SÍ pasa normalizarTelefono tal cual.
function telefonoUnico(): string {
  const ultimos8DeReloj = String(Date.now()).slice(-8);
  const azar4Digitos = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `+503${ultimos8DeReloj}${azar4Digitos}`; // +503 + 12 dígitos = 15, dentro del límite.
}

async function crearComercio(extra: Record<string, unknown> = {}): Promise<string> {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Portal Test', slug: `test-portal-${sufijo}`, ...extra })
    .select('id')
    .single();
  if (error) throw error;
  comerciosDePrueba.push(data.id);
  return data.id;
}

async function crearClienteConTarjeta(comercioId: string, puntos: number): Promise<string> {
  const telefono = telefonoUnico();
  const { data: cliente, error: eC } = await supabase
    .from('clientes')
    .insert({ nombre: 'Cliente Portal', telefono })
    .select('id')
    .single();
  if (eC) throw eC;
  clientesDePrueba.push(cliente.id);
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: puntos })
    .select('id')
    .single();
  if (eT) throw eT;
  tarjetasDePrueba.push(tarjeta.id);
  return telefono;
}

describe('formatearSaldo', () => {
  it('formatea puntos con singular y plural', () => {
    expect(formatearSaldo('puntos', 1, null)).toBe('1 punto');
    expect(formatearSaldo('puntos', 7, null)).toBe('7 puntos');
  });

  it('formatea sellos como "N de M sellos", y sin meta como "N sellos"', () => {
    expect(formatearSaldo('sellos', 7, 10)).toBe('7 de 10 sellos');
    expect(formatearSaldo('sellos', 3, null)).toBe('3 sellos');
  });
});

describe('buscarTarjetasPorTelefono', () => {
  it('devuelve encontrado:false para un teléfono bien formado pero no registrado', async () => {
    // Bien formado (normalizarTelefono lo acepta) mas nadie lo tiene: ejercita el camino real
    // de "no encontrado", no el de "formato inválido" (esa es la siguiente prueba).
    const res = await buscarTarjetasPorTelefono(supabase, telefonoUnico());
    expect(res.encontrado).toBe(false);
    expect(res.tarjetas).toHaveLength(0);
  });

  it('devuelve encontrado:false (no lanza) para un teléfono con formato irreconocible', async () => {
    // normalizarTelefono() lanza con esto (ni +503 válido de 8-15 dígitos ni local de 8). Fija
    // que el catch de buscarTarjetasPorTelefono lo convierte en "no encontrado", no en una
    // excepción sin capturar que tumbaría la ruta con un 500.
    const res = await buscarTarjetasPorTelefono(supabase, 'no-es-un-telefono');
    expect(res.encontrado).toBe(false);
    expect(res.tarjetas).toHaveLength(0);
  });

  it('devuelve la tarjeta de puntos con su saldo y comercio', async () => {
    const comercioId = await crearComercio(); // tipo_tarjeta usa el default 'puntos'
    const telefono = await crearClienteConTarjeta(comercioId, 7);

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    expect(res.encontrado).toBe(true);
    expect(res.nombreCliente).toBe('Cliente Portal');
    expect(res.tarjetas).toHaveLength(1);
    expect(res.tarjetas[0].comercioNombre).toBe('Comercio Portal Test');
    expect(res.tarjetas[0].puntosActuales).toBe(7);
    expect(res.tarjetas[0].saldoTexto).toBe('7 puntos');
  });

  it('encuentra al cliente aunque el teléfono se escriba distinto al guardado (normaliza)', async () => {
    // ESTA es la prueba que faltaba (hallazgo de la revisión de plan): registrarCliente() SIEMPRE
    // guarda en forma canónica +503XXXXXXXX (normalizarTelefono.ts). Sin normalizar también en la
    // búsqueda, un cliente real tecleando su número tal cual ("7777-1234") nunca habría
    // encontrado su propia tarjeta — y las demás pruebas de este archivo no lo detectan porque
    // insertan y consultan con el MISMO string crudo en ambos lados.
    const local8 = String(Date.now()).slice(-8); // el mismo truco de 8 dígitos que telefonoUnico()
    const canonico = `+503${local8}`;
    const { data: cliente, error: eC } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Formato Natural', telefono: canonico }).select('id').single();
    if (eC) throw eC;
    clientesDePrueba.push(cliente.id);
    const comercioId = await crearComercio();
    const { data: t, error: eT } = await supabase
      .from('tarjetas').insert({ cliente_id: cliente.id, comercio_id: comercioId, puntos_actuales: 3 }).select('id').single();
    if (eT) throw eT;
    tarjetasDePrueba.push(t.id);

    // Se consulta con la forma NATURAL que alguien tecléa a mano — con guion, sin +503 — no con
    // el string canónico que se guardó.
    const formatoNatural = `${local8.slice(0, 4)}-${local8.slice(4)}`;
    const res = await buscarTarjetasPorTelefono(supabase, formatoNatural);

    expect(res.encontrado).toBe(true);
    expect(res.nombreCliente).toBe('Cliente Formato Natural');
  });

  it('formatea una tarjeta de sellos como "N de M sellos"', async () => {
    const comercioId = await crearComercio({ tipo_tarjeta: 'sellos', sello_meta: 10 });
    const telefono = await crearClienteConTarjeta(comercioId, 7);

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    expect(res.tarjetas[0].tipoTarjeta).toBe('sellos');
    expect(res.tarjetas[0].selloMeta).toBe(10);
    expect(res.tarjetas[0].saldoTexto).toBe('7 de 10 sellos');
  });

  it('incluye solo las recompensas activas del comercio', async () => {
    const comercioId = await crearComercio();
    const telefono = await crearClienteConTarjeta(comercioId, 5);
    const { error } = await supabase.from('recompensas').insert([
      { comercio_id: comercioId, nombre: 'Café gratis', costo_puntos: 10, tipo: 'articulo_gratis', activa: true },
      { comercio_id: comercioId, nombre: 'Descuento viejo', costo_puntos: 5, tipo: 'otro', activa: false },
    ]);
    if (error) throw error;

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    // Sin el .eq('activa', true), aparecerían las dos.
    expect(res.tarjetas[0].recompensas).toHaveLength(1);
    expect(res.tarjetas[0].recompensas[0].nombre).toBe('Café gratis');
  });

  it('devuelve las tarjetas de varios comercios sin mezclar sus recompensas', async () => {
    const comercioA = await crearComercio();
    const comercioB = await crearComercio();
    // Mismo cliente en ambos comercios: se registra una vez y suma tarjetas (clientes es global).
    const telefono = telefonoUnico();
    const { data: cliente, error: eC } = await supabase
      .from('clientes').insert({ nombre: 'Cliente Multi', telefono }).select('id').single();
    if (eC) throw eC;
    clientesDePrueba.push(cliente.id);
    for (const comercioId of [comercioA, comercioB]) {
      const { data: t, error: eT } = await supabase
        .from('tarjetas').insert({ cliente_id: cliente.id, comercio_id: comercioId }).select('id').single();
      if (eT) throw eT;
      tarjetasDePrueba.push(t.id);
    }
    const { error: eR } = await supabase.from('recompensas').insert([
      { comercio_id: comercioA, nombre: 'Premio A', costo_puntos: 10, tipo: 'otro', activa: true },
      { comercio_id: comercioB, nombre: 'Premio B', costo_puntos: 10, tipo: 'otro', activa: true },
    ]);
    if (eR) throw eR;

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    expect(res.tarjetas).toHaveLength(2);
    // Cada tarjeta lleva SOLO las recompensas de su propio comercio (pin del agrupado por comercio_id).
    const porComercio = Object.fromEntries(res.tarjetas.map((t) => [t.comercioNombre, t.recompensas.map((r) => r.nombre)]));
    for (const nombres of Object.values(porComercio)) {
      expect(nombres).toHaveLength(1);
    }
    const todos = res.tarjetas.flatMap((t) => t.recompensas.map((r) => r.nombre)).sort();
    expect(todos).toEqual(['Premio A', 'Premio B']);
  });
});
