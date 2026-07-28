import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { acreditarPuntos, acreditarForzado } from '../comercio/acreditar';
import { quitarPuntos } from '../comercio/ajuste';
import { historialParaCliente } from './historialCliente';
import { buscarTarjetasPorTelefono } from './buscarTarjetas';

const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

describe('historialParaCliente', () => {
  it('NO expone cajero, motivo, marca de forzada ni monto', async () => {
    // ESTA es la razón de existir del módulo. El historial del dueño trae el correo del cajero y
    // los motivos internos; si esa forma se filtrara al portal, un cliente vería las cuentas de los
    // empleados del negocio y notas escritas para el dueño ("el cajero nuevo se equivocó otra vez").
    //
    // Se asierta sobre las CLAVES del objeto, no sobre valores: una regresión típica es reenviar el
    // objeto entero del dueño, y ahí los valores correctos seguirían estando pero acompañados de
    // los que no deben viajar.
    const comercioId = await entorno.crearComercio({
      tope_acreditaciones_dia: 1,
      pedir_monto_compra: true,
    });
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const sucursalId = await entorno.crearSucursal(comercioId);
    const cajeroId = await entorno.crearCajero(comercioId);

    await acreditarPuntos(supabase, comercioId, id, 1, {
      sucursalId,
      cajeroUsuarioId: cajeroId,
      montoCompra: 14.5,
    });
    await acreditarForzado(supabase, comercioId, id, 1, 'motivo interno del dueno', {
      sucursalId,
      cajeroUsuarioId: cajeroId,
    });
    await quitarPuntos(supabase, comercioId, id, 1, 'nota interna del cajero', {
      sucursalId,
      cajeroUsuarioId: cajeroId,
    });

    const movimientos = await historialParaCliente(supabase, comercioId, id);
    expect(movimientos).toHaveLength(3);

    const permitidas = [
      'id',
      'ocurrioEn',
      'clase',
      'delta',
      'saldoResultante',
      'sucursalNombre',
      'recompensaNombre',
    ].sort();

    for (const m of movimientos) {
      expect(Object.keys(m).sort()).toEqual(permitidas);
    }

    // Y por si alguien agregara una clave nueva a la lista permitida sin pensarlo: ningún valor
    // serializado puede contener los textos internos ni el correo del cajero.
    const serializado = JSON.stringify(movimientos);
    expect(serializado).not.toContain('motivo interno del dueno');
    expect(serializado).not.toContain('nota interna del cajero');
    expect(serializado).not.toContain('@ejemplo.test');
    expect(serializado).not.toContain('14.5');
  });

  it('sí expone lo que hace útil la pantalla al cliente', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    const sucursalId = await entorno.crearSucursal(comercioId);

    await acreditarPuntos(supabase, comercioId, id, 3, { sucursalId });

    const [movimiento] = await historialParaCliente(supabase, comercioId, id);
    expect(movimiento.clase).toBe('acreditacion');
    expect(movimiento.delta).toBe(3);
    expect(movimiento.saldoResultante).toBe(3);
    expect(movimiento.sucursalNombre).toBe('Sucursal Prueba');
    expect(typeof movimiento.ocurrioEn).toBe('string');
  });

  it('el portal entrega los movimientos junto con el saldo', async () => {
    // Integración de punta a punta de la capa de datos del portal: lo que ve el cliente al consultar
    // por su teléfono.
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);
    await acreditarPuntos(supabase, comercioId, id, 2);

    const { data: cliente } = await supabase
      .from('tarjetas')
      .select('clientes(telefono)')
      .eq('id', id)
      .single();

    const resultado = await buscarTarjetasPorTelefono(supabase, cliente!.clientes!.telefono);

    expect(resultado.encontrado).toBe(true);
    expect(resultado.tarjetas).toHaveLength(1);
    expect(resultado.tarjetas[0].movimientos).toHaveLength(1);
    expect(resultado.tarjetas[0].movimientos[0].delta).toBe(2);
  });

  it('una tarjeta sin movimientos devuelve lista vacía, no falla', async () => {
    const comercioId = await entorno.crearComercio();
    const { id } = await entorno.crearTarjeta(comercioId, 0);

    expect(await historialParaCliente(supabase, comercioId, id)).toEqual([]);
  });
});
