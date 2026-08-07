import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { crearEntorno } from '../../test/fixtures/entornoComercio';
import { crearPrograma } from './programas';
import { altaYAcreditacionPorTelefono } from './altaPorTelefono';

// Dar de alta y acreditar por TELÉFONO, desde el panel del comercio.
//
// Es la fase D v1 del spec de delivery: cubre los pedidos donde el comercio SÍ sabe quién compró
// (llamada, WhatsApp, app propia, apps de delivery que comparten el número), que son la mayoría.
// El código al portador queda para el caso del cliente anónimo, que es otro problema.
//
// El hueco que cierra: `registrarCliente` tenía un solo llamador —el formulario que abre el cliente
// tras escanear el QR del local—, así que un comercio no podía darle una tarjeta a alguien que no
// estaba parado enfrente.
const supabase = createServiceClient();
const entorno = crearEntorno(supabase);

afterEach(async () => {
  await entorno.limpiar();
});

function telefonoUnico(): string {
  return `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

async function estadoDe(tarjetaId: string) {
  const { data } = await supabase
    .from('tarjetas')
    .select('puntos_actuales, apple_serial_number')
    .eq('id', tarjetaId)
    .single();
  return data!;
}

describe('altaYAcreditacionPorTelefono', () => {
  it('a un teléfono nuevo le crea la tarjeta y le acredita de una', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono: telefonoUnico(),
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) return;
    expect(res.esNuevaTarjeta).toBe(true);

    const estado = await estadoDe(res.tarjetaId);
    expect(estado.puntos_actuales).toBe(1);
    // Y le tiene que servir de algo: sin serial, el pase no se puede emitir y el cliente encuentra
    // su tarjeta en el portal con un botón que no hace nada.
    expect(estado.apple_serial_number, 'la tarjeta nació sin poder instalarse').toBe(res.tarjetaId);
  });

  it('a un teléfono que YA tiene tarjeta le acredita sobre la que existe', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const telefono = telefonoUnico();

    const primera = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });
    const segunda = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });

    expect(primera.ok && segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;
    expect(segunda.tarjetaId, 'le creó una segunda tarjeta al mismo cliente').toBe(primera.tarjetaId);
    expect(segunda.esNuevaTarjeta).toBe(false);
    expect((await estadoDe(primera.tarjetaId)).puntos_actuales).toBe(2);
  });

  it('el teléfono se normaliza: "7777-1234" y "+50377771234" son el MISMO cliente', async () => {
    // Regla de la casa: `clientes.telefono` se guarda SIEMPRE canónico. Sin normalizar acá, el
    // comercio que teclea el número como se lo dictaron por teléfono le crearía una tarjeta NUEVA
    // a alguien que ya tenía la suya, y los sellos quedarían partidos en dos.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const ochoDigitos = `7${String(Date.now()).slice(-7)}`;

    const crudo = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono: `${ochoDigitos.slice(0, 4)}-${ochoDigitos.slice(4)}`,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });
    const canonico = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono: `+503${ochoDigitos}`,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });

    expect(crudo.ok && canonico.ok).toBe(true);
    if (!crudo.ok || !canonico.ok) return;
    expect(canonico.tarjetaId).toBe(crudo.tarjetaId);
  });

  it('un teléfono con formato irreconocible se rechaza SIN crear nada', async () => {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const { count: antes } = await supabase
      .from('tarjetas').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId);

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono: 'no-es-un-telefono',
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('teléfono');
    const { count: despues } = await supabase
      .from('tarjetas').select('id', { count: 'exact', head: true }).eq('comercio_id', comercioId);
    expect(despues).toBe(antes);
  });

  it('los tipos SIN contador se rechazan con el motivo, no con un error genérico', async () => {
    // En cupón, membresía y descuento no hay número que sumar: su estado es una fecha o un nivel.
    // Dejar pasar la operación acreditaría sobre una columna que nadie lee, y el dueño creería que
    // le dio algo a su cliente.
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const cupon = await crearPrograma(supabase, comercioId, {
      nombre: 'Cupón de bienvenida',
      tipoTarjeta: 'cupon',
      cashbackPorcentaje: null,
      multipassVisitas: null,
      membresiaDias: null,
      cuponVigenciaDias: 7,
    });
    if (!cupon.ok) throw new Error(cupon.error);

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono: telefonoUnico(),
      nombre: 'Cliente Delivery',
      programaId: cupon.id,
      cantidad: 1,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('cupón');
  });

  it('hereda los topes antifraude porque pasa por el camino de acreditar', async () => {
    // Es la ventaja de reusar acreditarPuntos en vez de escribir un update propio: las cuatro
    // perillas de la Tanda 1 aplican solas. Un camino paralelo sería una puerta trasera al tope.
    const comercioId = await entorno.crearComercio({
      tipo_tarjeta: 'sellos',
      tope_acreditaciones_dia: 1,
    });
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const telefono = telefonoUnico();

    const primera = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono, nombre: 'Cliente Delivery', programaId, cantidad: 1,
    });
    const segunda = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono, nombre: 'Cliente Delivery', programaId, cantidad: 1,
    });

    expect(primera.ok).toBe(true);
    expect(segunda.ok).toBe(false);
    if (!segunda.ok) expect(segunda.bloqueoLimite).toBe(true);
    if (primera.ok) expect((await estadoDe(primera.tarjetaId)).puntos_actuales).toBe(1);
  });

  it('NO acredita en un programa de otro comercio', async () => {
    const mio = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const ajeno = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    const programaAjeno = entorno.obtenerProgramaPrincipal(ajeno);

    const res = await altaYAcreditacionPorTelefono(supabase, mio, {
      telefono: telefonoUnico(),
      nombre: 'Cliente Delivery',
      programaId: programaAjeno,
      cantidad: 1,
    });

    expect(res.ok).toBe(false);
  });
});
