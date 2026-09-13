import { afterEach, describe, expect, it } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { correosDeDuenos } from './conversionesMeta';

// Integración contra la base: la consulta que decide A QUIÉN atribuye Meta un pago. Lo que importa
// es lo que NO entra (cajeros, dueños dados de baja, dueños de otra cuenta), porque cada correo que
// sobra es un dato de alguien que no pagó mandado a Meta.

const supabase = createServiceClient();
const usuarios: string[] = [];
const comercios: string[] = [];
const cuentas: string[] = [];
const sufijo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

afterEach(async () => {
  // usuarios_comercio apunta a comercios y comercios a cuentas, sin cascade: en ese orden.
  if (usuarios.length) await supabase.from('usuarios_comercio').delete().in('id', usuarios.splice(0));
  if (comercios.length) await supabase.from('comercios').delete().in('id', comercios.splice(0));
  if (cuentas.length) await supabase.from('cuentas_comercio').delete().in('id', cuentas.splice(0));
});

async function crearCuenta(): Promise<string> {
  const { data, error } = await supabase
    .from('cuentas_comercio')
    .insert({ nombre: `Cuenta Meta ${sufijo()}` })
    .select('id')
    .single();
  if (error) throw error;
  cuentas.push(data.id);
  return data.id;
}

async function crearComercio(cuentaId: string): Promise<string> {
  const { data, error } = await supabase
    .from('comercios')
    .insert({ nombre: 'Comercio Meta', slug: `test-meta-${sufijo()}`, cuenta_id: cuentaId })
    .select('id')
    .single();
  if (error) throw error;
  comercios.push(data.id);
  return data.id;
}

async function crearUsuario(comercioId: string, email: string, rol: string, activo = true): Promise<void> {
  const { data, error } = await supabase
    .from('usuarios_comercio')
    .insert({ comercio_id: comercioId, email, rol, activo })
    .select('id')
    .single();
  if (error) throw error;
  usuarios.push(data.id);
}

describe('correosDeDuenos', () => {
  it('trae a los dueños activos de TODOS los comercios de la cuenta, y a nadie más', async () => {
    const cuenta = await crearCuenta();
    const otraCuenta = await crearCuenta();
    const comercioA = await crearComercio(cuenta);
    const comercioB = await crearComercio(cuenta);
    const comercioAjeno = await crearComercio(otraCuenta);

    const s = sufijo();
    await crearUsuario(comercioA, `duena-a-${s}@ejemplo.test`, 'owner');
    await crearUsuario(comercioB, `dueno-b-${s}@ejemplo.test`, 'owner');
    await crearUsuario(comercioA, `cajero-${s}@ejemplo.test`, 'cajero');
    await crearUsuario(comercioB, `baja-${s}@ejemplo.test`, 'owner', false);
    await crearUsuario(comercioAjeno, `ajeno-${s}@ejemplo.test`, 'owner');

    const correos = await correosDeDuenos(supabase, cuenta);
    expect(correos.sort()).toEqual([`duena-a-${s}@ejemplo.test`, `dueno-b-${s}@ejemplo.test`]);
  });

  it('una cuenta sin comercios no trae correos', async () => {
    const cuenta = await crearCuenta();
    expect(await correosDeDuenos(supabase, cuenta)).toEqual([]);
  });
});
