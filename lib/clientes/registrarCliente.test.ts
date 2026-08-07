import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { registrarCliente } from './registrarCliente';

const supabase = createServiceClient();
let ids: { comercioId: string } | null = null;
let idsB: { comercioId: string } | null = null;
const telefonosDePrueba: string[] = [];
const programasDePrueba: string[] = [];

afterEach(async () => {
  // Orden importa: borrar hijos (tarjetas) antes que padres (clientes/comercios) por las foreign
  // keys, y programas_tarjeta después de tarjetas (que lo referencian) y antes de comercios (al
  // que el programa referencia).
  const comercioIds = [ids?.comercioId, idsB?.comercioId].filter(Boolean) as string[];
  if (comercioIds.length) {
    await supabase.from('tarjetas').delete().in('comercio_id', comercioIds);
  }
  if (telefonosDePrueba.length) {
    await supabase.from('clientes').delete().in('telefono', telefonosDePrueba);
    telefonosDePrueba.length = 0;
  }
  if (programasDePrueba.length) {
    await supabase.from('programas_tarjeta').delete().in('id', programasDePrueba);
    programasDePrueba.length = 0;
  }
  if (comercioIds.length) {
    await supabase.from('comercios').delete().in('id', comercioIds);
  }
  ids = null;
  idsB = null;
});

// Comercio + su programa principal (migración 0024: toda tarjeta necesita programa_id).
async function crearComercioDePrueba(slug: string): Promise<{ comercioId: string; programaId: string }> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio de prueba', slug })
    .select('id, nombre, tipo_tarjeta')
    .single();
  if (error) throw error;

  const { data: programa, error: eP } = await supabase
    .from('programas_tarjeta')
    .insert({ comercio_id: data.id, nombre: data.nombre, slug: 'principal', tipo_tarjeta: data.tipo_tarjeta, es_principal: true })
    .select('id')
    .single();
  if (eP) throw eP;
  programasDePrueba.push(programa.id);

  return { comercioId: data.id, programaId: programa.id };
}

describe('registrarCliente', () => {
  it('crea cliente y tarjeta nuevos cuando el teléfono no existe', async () => {
    const { comercioId, programaId } = await crearComercioDePrueba(`test-a-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const resultado = await registrarCliente(supabase, comercioId, programaId, 'Cliente Prueba', telefono);

    expect(resultado.esNuevoCliente).toBe(true);
    expect(resultado.esNuevaTarjeta).toBe(true);
    expect(resultado.qrToken).toHaveLength(32);
  });

  it('reutiliza el cliente si el teléfono ya existe en OTRO comercio', async () => {
    const comercioA = await crearComercioDePrueba(`test-b1-${Date.now()}`);
    const comercioB = await crearComercioDePrueba(`test-b2-${Date.now()}`);
    ids = { comercioId: comercioA.comercioId };
    idsB = { comercioId: comercioB.comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const primero = await registrarCliente(supabase, comercioA.comercioId, comercioA.programaId, 'Cliente Prueba', telefono);
    const segundo = await registrarCliente(supabase, comercioB.comercioId, comercioB.programaId, 'Cliente Prueba', telefono);

    expect(segundo.clienteId).toBe(primero.clienteId);
    expect(segundo.tarjetaId).not.toBe(primero.tarjetaId);
    expect(segundo.esNuevoCliente).toBe(false);
    expect(segundo.esNuevaTarjeta).toBe(true);
  });

  it('recupera la misma tarjeta si el teléfono ya existe en el MISMO comercio', async () => {
    const { comercioId, programaId } = await crearComercioDePrueba(`test-c-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const primero = await registrarCliente(supabase, comercioId, programaId, 'Cliente Prueba', telefono);
    const segundo = await registrarCliente(supabase, comercioId, programaId, 'Cliente Prueba', telefono);

    expect(segundo.tarjetaId).toBe(primero.tarjetaId);
    // El qr_token no debe cambiar entre registros: los passes ya emitidos siguen siendo escaneables.
    expect(segundo.qrToken).toBe(primero.qrToken);
    expect(segundo.esNuevaTarjeta).toBe(false);
  });

  it('converge en una sola identidad cuando dos registros del mismo teléfono corren en paralelo', async () => {
    const { comercioId, programaId } = await crearComercioDePrueba(`test-d-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    // Sin importar quién gane la carrera del insert (vía unique + reintento con relectura),
    // ambas llamadas deben terminar apuntando al mismo cliente y la misma tarjeta.
    const [a, b] = await Promise.all([
      registrarCliente(supabase, comercioId, programaId, 'Cliente Prueba', telefono),
      registrarCliente(supabase, comercioId, programaId, 'Cliente Prueba', telefono),
    ]);

    expect(a.clienteId).toBe(b.clienteId);
    expect(a.tarjetaId).toBe(b.tarjetaId);
  });

  it('un mismo cliente recibe UNA tarjeta por cada programa del MISMO comercio', async () => {
    // La razón de ser de la migración 0024: antes la unicidad era (cliente_id, comercio_id) y esto
    // habría devuelto la misma tarjeta dos veces. Ahora es (cliente_id, programa_id) — "Sellos" y
    // "Cupón de bienvenida" del mismo local son tarjetas independientes.
    const { comercioId, programaId: principalId } = await crearComercioDePrueba(`test-e-${Date.now()}`);
    ids = { comercioId };
    const { data: segundoPrograma, error: eP } = await supabase
      .from('programas_tarjeta')
      .insert({ comercio_id: comercioId, nombre: 'Cupón de bienvenida', slug: 'bienvenida', tipo_tarjeta: 'cupon' })
      .select('id')
      .single();
    if (eP) throw eP;
    programasDePrueba.push(segundoPrograma.id);

    const telefono = `+503-test-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const enPrincipal = await registrarCliente(supabase, comercioId, principalId, 'Cliente Prueba', telefono);
    const enSegundo = await registrarCliente(supabase, comercioId, segundoPrograma.id, 'Cliente Prueba', telefono);

    expect(enSegundo.clienteId).toBe(enPrincipal.clienteId);
    expect(enSegundo.tarjetaId).not.toBe(enPrincipal.tarjetaId);
    expect(enSegundo.esNuevoCliente).toBe(false);
    expect(enSegundo.esNuevaTarjeta).toBe(true);

    // Repetir el registro en el mismo programa recupera la MISMA tarjeta, no una tercera.
    const otraVezPrincipal = await registrarCliente(supabase, comercioId, principalId, 'Cliente Prueba', telefono);
    expect(otraVezPrincipal.tarjetaId).toBe(enPrincipal.tarjetaId);
    expect(otraVezPrincipal.esNuevaTarjeta).toBe(false);
  });

  it('la tarjeta nace INSTALABLE: con serial y token de Apple', async () => {
    // Sin estos dos campos, /api/tarjetas/<id>/pass.pkpass devuelve 404 y el cliente encuentra su
    // tarjeta en el portal pero el boton de agregarla a la billetera no hace nada.
    //
    // Vivian en app/api/registro/route.ts, o sea en el UNICO llamador. Mientras hubo uno solo no se
    // noto; en cuanto el panel del comercio puede dar de alta a un cliente de delivery, ese camino
    // habria emitido tarjetas imposibles de instalar. Es el mismo patron que ya aparecio con
    // sello_meta y con la vigencia del cupon: un paso imprescindible que vive en el caller.
    const { comercioId, programaId } = await crearComercioDePrueba(`test-instalable-${Date.now()}`);
    ids = { comercioId };
    const telefono = `+503-test-inst-${Date.now()}`;
    telefonosDePrueba.push(telefono);

    const res = await registrarCliente(supabase, comercioId, programaId, 'Cliente Prueba', telefono);

    const { data } = await supabase
      .from('tarjetas')
      .select('apple_serial_number, apple_auth_token')
      .eq('id', res.tarjetaId)
      .single();

    expect(data!.apple_serial_number, 'sin serial, el pase no se puede emitir').toBe(res.tarjetaId);
    expect(data!.apple_auth_token, 'sin token, el pase no se puede autenticar').toBeTruthy();
  });
});
