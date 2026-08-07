import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma, listarProgramas } from '../comercio/programas';
import { guardarBranding } from '../comercio/guardarBranding';
import { registrarCliente } from '../clientes/registrarCliente';
import { venderPaquete } from './prepago';
import { acreditarCashback } from './dinero';
import { renovarMembresia } from './vigencia';
import { crearNivel, registrarCompra } from './descuento';
import { buscarTarjetasPorTelefono } from '../portal/buscarTarjetas';

// ¿Los ocho tipos funcionan de verdad, por el camino que recorre un dueño real?
//
// Por qué este archivo existe y por qué NO alcanzaba con prepago.test.ts / dinero.test.ts /
// vigencia.test.ts: esos crean el comercio con `crearComercio({ multipass_visitas: 10 })`, y el
// fixture ESPEJA esa configuración al programa principal (ver entornoComercio.ts). Así, la
// configuración queda en las DOS tablas y la prueba pasa lea el motor la que lea.
//
// En producción no existe ese espejo. Desde la migración 0024 la configuración por tipo la escribe
// SOLO `programas_tarjeta` (pantalla Programas → FormularioConfiguracionPrograma); las columnas
// homónimas de `comercios` quedaron legadas y NADIE las escribe. Un comercio dado de alta después
// de la 0024 las tiene en null para siempre.
//
// Por eso acá la configuración se carga con `crearPrograma()` —la MISMA función que usa la
// pantalla— y el comercio se deja con sus columnas legadas vacías. Es la única forma de que la
// prueba mida lo que el dueño vive.
const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

// El programa lo crea la función de producción; la tarjeta cuelga de ÉL, no del principal.
async function programaConTarjeta(
  comercioId: string,
  datos: Parameters<typeof crearPrograma>[2],
  puntos = 0,
): Promise<{ programaId: string; tarjetaId: string }> {
  const res = await crearPrograma(supabase, comercioId, datos);
  if (!res.ok) throw new Error(`no se pudo crear el programa de prueba: ${res.error}`);
  const { id } = await entorno.crearTarjeta(comercioId, puntos, { programaId: res.id });
  return { programaId: res.id, tarjetaId: id };
}

async function saldoDe(tarjetaId: string): Promise<number> {
  const { data } = await supabase.from('tarjetas').select('puntos_actuales').eq('id', tarjetaId).single();
  return data!.puntos_actuales;
}

describe('la configuración que carga el dueño en Programas llega a los motores', () => {
  it('prepago: vender un paquete usa las visitas del PROGRAMA', async () => {
    // El comercio queda con multipass_visitas en null, como todo comercio nacido después de la 0024.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { tarjetaId } = await programaConTarjeta(comercioId, {
      nombre: 'Paquete de clases',
      tipoTarjeta: 'prepago',
      cashbackPorcentaje: null,
      multipassVisitas: 10,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });

    const res = await venderPaquete(supabase, comercioId, tarjetaId);

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    expect(await saldoDe(tarjetaId)).toBe(10);
  });

  it('cashback: el porcentaje sale del PROGRAMA', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { tarjetaId } = await programaConTarjeta(comercioId, {
      nombre: 'Devolución',
      tipoTarjeta: 'cashback',
      cashbackPorcentaje: 5,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });

    // $20.00 al 5% = $1.00.
    const res = await acreditarCashback(supabase, comercioId, tarjetaId, 2000);

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    expect(await saldoDe(tarjetaId)).toBe(100);
  });

  it('membresía: los días de la renovación salen del PROGRAMA', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { tarjetaId } = await programaConTarjeta(comercioId, {
      nombre: 'Socios',
      tipoTarjeta: 'membresia',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: 30,
      cuponVigenciaDias: null,
    });

    const res = await renovarMembresia(supabase, comercioId, tarjetaId);

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const { data } = await supabase.from('tarjetas').select('vigencia_hasta').eq('id', tarjetaId).single();
    expect(data!.vigencia_hasta).not.toBeNull();
  });

  it('cupón: la tarjeta nace con la vigencia que configuró el dueño', async () => {
    // Sin esto el cupón no vence NUNCA: usar_cupon_atomico deja pasar `vigencia_hasta is null`, así
    // que una campaña de 7 días queda canjeable para siempre.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const res = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón de bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 7,
    });
    if (!res.ok) throw new Error(res.error);

    const alta = await registrarCliente(
      supabase,
      comercioId,
      res.id,
      'Cliente Cupón',
      `+503${String(Date.now()).slice(-8)}`,
    );

    const { data } = await supabase
      .from('tarjetas')
      .select('vigencia_hasta')
      .eq('id', alta.tarjetaId)
      .single();
    expect(data!.vigencia_hasta).not.toBeNull();
  });
});

describe('descuento por nivel: de un umbral cargado a un porcentaje aplicado', () => {
  it('con un nivel cargado, registrar una compra que lo supera devuelve el porcentaje', async () => {
    // El recorrido entero del tipo: el dueño carga la escalera (lo que hasta ahora NINGUNA pantalla
    // permitía — crearNivel existía sin llamador), el cajero registra la compra, y el cliente queda
    // con su descuento. Sin el nivel, todo esto corría igual y devolvía null para siempre.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { tarjetaId } = await programaConTarjeta(comercioId, {
      nombre: 'Clientes frecuentes',
      tipoTarjeta: 'descuento',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });

    // $50.00 gastados ⇒ 5%.
    const nivel = await crearNivel(supabase, comercioId, 5000, 5);
    expect(nivel.ok, nivel.ok ? '' : nivel.error).toBe(true);

    const res = await registrarCompra(supabase, comercioId, tarjetaId, 6000);

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (res.ok) {
      expect(res.acumuladoCentavos).toBe(6000);
      expect(res.porcentaje).toBe(5);
    }
  });

  it('sin ningún nivel cargado, el tipo no le da descuento a nadie', async () => {
    // La otra mitad: si esto también diera un porcentaje, la prueba de arriba pasaría sin que el
    // nivel sirviera para nada.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const { tarjetaId } = await programaConTarjeta(comercioId, {
      nombre: 'Sin escalera',
      tipoTarjeta: 'descuento',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });

    const res = await registrarCompra(supabase, comercioId, tarjetaId, 6000);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.porcentaje).toBeNull();
  });
});

describe('la meta de sellos: quien la lee y quien la escribe miran la MISMA fila', () => {
  it('lo que guarda Marca es lo que devuelve el programa principal', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });

    const res = await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 8,
      difuminado_franja: 'medio',
    });
    expect(res.ok, res.ok ? '' : res.error).toBe(true);

    const programas = await listarProgramas(supabase, comercioId);
    const principal = (programas ?? []).find((p) => p.esPrincipal);
    expect(principal?.selloMeta).toBe(8);
  });

  it('el tipo del PROGRAMA manda aunque el panel de FM le cambie el tipo al comercio', async () => {
    // El daño concreto que documentaba el pendiente #1: la pantalla de Marca decidía si mostrar
    // "Meta de sellos" con `comercios.tipo_tarjeta`, pero el guardado escribe la meta en el programa
    // PRINCIPAL. Si FM le cambiaba el tipo al comercio sin propagarlo, Marca escondía el campo, el
    // formulario mandaba la meta vacía y el siguiente guardado se la BORRABA al principal: la grilla
    // de sellos desaparecía de todos los pases sin que nadie hubiera tocado nada.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    await guardarBranding(supabase, comercioId, {
      color_fondo: 'rgb(10, 20, 30)',
      color_texto: 'rgb(255, 255, 255)',
      color_label: 'rgb(255, 255, 255)',
      sello_meta: 8,
      difuminado_franja: 'medio',
    });

    // FM le cambia el tipo al COMERCIO y no toca el programa: la divergencia que abría el agujero.
    await supabase.from('comercios').update({ tipo_tarjeta: 'cupon' }).eq('id', comercioId);

    const principal = ((await listarProgramas(supabase, comercioId)) ?? []).find((p) => p.esPrincipal);
    // Las pantallas leen ESTO, no la columna del comercio: siguen viendo sellos con su meta intacta.
    expect(principal?.tipoTarjeta).toBe('sellos');
    expect(principal?.selloMeta).toBe(8);
  });
});

describe('el portal del cliente no le muestra plata como si fueran puntos', () => {
  // Va por buscarTarjetasPorTelefono y no por el formateador pelado A PROPÓSITO: el defecto nunca
  // estuvo en el formateador —describirSaldo siempre supo decir "$25.00"— sino en que la CONSULTA
  // del portal no traía las columnas que necesita. Una prueba unitaria del formateador habría
  // pasado en verde con el portal roto. Ver lib/tarjetas/estadoTarjeta.ts.
  it('una gift card de $25.00 se lee en dólares, no como 2500 puntos', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programa = await crearPrograma(supabase, comercioId, {
      nombre: 'Gift card',
      tipoTarjeta: 'gift_card',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: null,
    });
    if (!programa.ok) throw new Error(programa.error);

    const telefono = `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')}`;
    const alta = await registrarCliente(supabase, comercioId, programa.id, 'Cliente Gift', telefono);
    await supabase.from('tarjetas').update({ puntos_actuales: 2500 }).eq('id', alta.tarjetaId);

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    const tarjeta = res.tarjetas.find((t) => t.tarjetaId === alta.tarjetaId);
    expect(tarjeta, 'el portal no encontró la tarjeta recién dada de alta').toBeDefined();
    expect(tarjeta!.saldoTexto).toContain('$25.00');
    expect(tarjeta!.saldoTexto).not.toContain('2500 puntos');
  });

  it('un cupón vencido dice que venció, no "0 puntos"', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programa = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón vencido',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 7,
    });
    if (!programa.ok) throw new Error(programa.error);

    const telefono = `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
      .toString()
      .padStart(4, '0')}`;
    const alta = await registrarCliente(supabase, comercioId, programa.id, 'Cliente Cupón', telefono);
    await supabase.from('tarjetas').update({ vigencia_hasta: '2020-01-01' }).eq('id', alta.tarjetaId);

    const res = await buscarTarjetasPorTelefono(supabase, telefono);

    const tarjeta = res.tarjetas.find((t) => t.tarjetaId === alta.tarjetaId);
    expect(tarjeta).toBeDefined();
    expect(tarjeta!.saldoTexto).toContain('Venció');
  });
});
