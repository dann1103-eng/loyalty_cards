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

  describe('el apellido, opcional desde el panel', () => {
    // En el registro público el apellido es obligatorio; acá no: quien atiende un pedido por
    // teléfono muchas veces solo sabe el nombre, y exigirlo sería inventarlo.
    //
    // Mutaciones verificadas (2026-09-17):
    //   - sin el `|| null` (el apellido recortado viaja como '') → fallan 5: "en blanco…" y las
    //     CUATRO altas de arriba que no mandan apellido, todas con `new row for relation "clientes"
    //     violates check constraint "clientes_apellido_check"` (23514: el alta ENTERA se cae, no
    //     solo el apellido).
    //   - sin el tope de 120 (`if (false)`) → falla "de 121 caracteres…" con el mismo CHECK lanzado
    //     en vez del mensaje: `new row for relation "clientes" violates check constraint
    //     "clientes_apellido_check"`.
    //   - pasarle siempre null a registrarCliente → falla "con apellido lo guarda recortado":
    //     `expected null to be 'Rivera'`.
    async function clienteDeTarjeta(tarjetaId: string) {
      const { data, error } = await supabase
        .from('tarjetas')
        .select('clientes(nombre, apellido)')
        .eq('id', tarjetaId)
        .single();
      if (error) throw error;
      return data.clientes;
    }

    it('con apellido lo guarda recortado', async () => {
      const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
      const programaId = entorno.obtenerProgramaPrincipal(comercioId);

      const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
        telefono: telefonoUnico(),
        nombre: 'María',
        apellido: '  Rivera ',
        programaId,
        cantidad: 1,
      });

      expect(res.ok, res.ok ? '' : res.error).toBe(true);
      if (!res.ok) return;
      expect((await clienteDeTarjeta(res.tarjetaId))?.apellido).toBe('Rivera');
    });

    it('en blanco o ausente, el cliente queda con apellido null (no con "")', async () => {
      // `clientes.apellido` tiene un CHECK de `btrim(apellido) <> ''` (0036): un '' que llegara a
      // la base tumbaría el alta ENTERA con 23514, no solo el apellido.
      const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
      const programaId = entorno.obtenerProgramaPrincipal(comercioId);

      const enBlanco = await altaYAcreditacionPorTelefono(supabase, comercioId, {
        telefono: telefonoUnico(),
        nombre: 'María',
        apellido: '   ',
        programaId,
        cantidad: 1,
      });
      const ausente = await altaYAcreditacionPorTelefono(supabase, comercioId, {
        telefono: telefonoUnico(),
        nombre: 'José',
        programaId,
        cantidad: 1,
      });

      expect(enBlanco.ok, enBlanco.ok ? '' : enBlanco.error).toBe(true);
      expect(ausente.ok, ausente.ok ? '' : ausente.error).toBe(true);
      if (!enBlanco.ok || !ausente.ok) return;
      expect((await clienteDeTarjeta(enBlanco.tarjetaId))?.apellido).toBeNull();
      expect((await clienteDeTarjeta(ausente.tarjetaId))?.apellido).toBeNull();
    });

    it('de 121 caracteres se rechaza con el motivo y SIN crear el cliente', async () => {
      const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
      const programaId = entorno.obtenerProgramaPrincipal(comercioId);
      const telefono = telefonoUnico();

      const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
        telefono,
        nombre: 'María',
        apellido: 'a'.repeat(121),
        programaId,
        cantidad: 1,
      });

      expect(res).toEqual({ ok: false, error: 'El apellido puede tener hasta 120 caracteres.' });
      const { data: cliente } = await supabase
        .from('clientes')
        .select('id')
        .eq('telefono', telefono)
        .maybeSingle();
      expect(cliente, 'se creó el cliente aunque el apellido no entraba').toBeNull();
    });
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

// La regla de mínimo de compra del comercio (migración 0039, lib/comercio/montoAcreditacion.ts),
// aplicada acá en "Agregar cliente" (Tarea 6, plan 2026-09-23-onboarding-manifest-monto-resena.md,
// decisión 7 de la spec): sin esto, dar de alta por teléfono sería el camino para esquivar el
// mínimo que el escáner ya exige (Tarea 5, app/comercio/(protegido)/escanear/actions.test.ts).
//
// ESTADO DE LA 0039 (2026-09-23): TODAVÍA NO ESTÁ APLICADA en esta base (confirmado corriendo
// `npx tsx --env-file=.env.local --conditions=react-server scripts/verificar-0039.ts`, que respondió
// "FALLO: la migración 0039 NO está aplicada" con detalle "column comercios.exigir_monto_compra
// does not exist"). `setearReglaMinimo` de abajo hace un UPDATE con las columnas nuevas, y
// PostgREST lo rechaza con PGRST204 ("Could not find the 'exigir_monto_compra' column of
// 'comercios' in the schema cache") ANTES de que cualquier prueba de este describe llegue a llamar
// a `altaYAcreditacionPorTelefono` — es el rojo esperado por "Antes de empezar" del plan (mismo
// mecanismo, mismo mensaje, que documenta escanear/actions.test.ts para su describe homónimo). El
// verde y las mutaciones de abajo se difieren a la Tarea 9 (cierre, con la 0039 ya migrada).
//
// MUTACIONES PENDIENTES (correrlas recién en la Tarea 9, con la base migrada):
// - Mover el chequeo del monto FALTANTE (paso 1 de validarMontoAcreditacion, hoy ANTES de
//   registrarCliente en altaPorTelefono.ts) a DESPUÉS de registrarCliente: tiene que hacer fallar
//   "sin monto → ... y NO existe cliente con ese teléfono" — el cliente pasaría a existir igual.
// - No pasar `montoCompra` a `acreditarPuntos` (dejar `opciones` tal cual venía, sin el spread
//   nuevo): tiene que hacer fallar "con 1000 → ... la transacción del ledger tiene monto_compra =
//   10" — la columna quedaría en null.
// - Leer la regla (`leerReglaDeMonto`) recién DESPUÉS de `registrarCliente` en vez de antes: tiene
//   que hacer fallar "sin monto → ... NO existe cliente" por la misma razón de fondo que la primera
//   mutación (el orden es justo lo que esa prueba protege).
describe('la regla de mínimo de compra en "Agregar cliente" (0039)', () => {
  // Las TRES columnas juntas en UN update: `exigir` implica `pedir`, y el mínimo implica `exigir`
  // (los dos CHECK nuevos de la 0039) — poner solo `monto_minimo_compra_centavos` sin las otras dos
  // viola esos CHECK aunque las columnas SÍ existieran. Mismo helper que
  // escanear/actions.test.ts:setearReglaMinimo.
  async function setearReglaMinimo(comercioId: string, minimoCentavos: number) {
    const { error } = await supabase
      .from('comercios')
      .update({ pedir_monto_compra: true, exigir_monto_compra: true, monto_minimo_compra_centavos: minimoCentavos })
      .eq('id', comercioId);
    if (error) throw error;
  }

  async function comercioDeSellosConMinimo() {
    const comercioId = await entorno.crearComercio({ tipo_tarjeta: 'sellos' });
    await setearReglaMinimo(comercioId, 1000);
    return comercioId;
  }

  async function tarjetaPorTelefono(comercioId: string, telefono: string) {
    const { data: cliente, error: e1 } = await supabase
      .from('clientes')
      .select('id')
      .eq('telefono', telefono)
      .maybeSingle();
    if (e1) throw e1;
    if (!cliente) return null;
    const { data: tarjeta, error: e2 } = await supabase
      .from('tarjetas')
      .select('id, puntos_actuales')
      .eq('cliente_id', cliente.id)
      .eq('comercio_id', comercioId)
      .maybeSingle();
    if (e2) throw e2;
    return tarjeta;
  }

  async function primeraTransaccionDe(tarjetaId: string) {
    const { data, error } = await supabase
      .from('transacciones_puntos')
      .select('monto_compra')
      .eq('tarjeta_id', tarjetaId)
      .eq('tipo', 'acreditacion')
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  it('sin monto: error de monto faltante EXACTO y NO existe cliente con ese teléfono', async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const telefono = telefonoUnico();

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Escribí el monto de la compra (por ejemplo 19.99).');
      expect(res.bloqueoLimite).toBeUndefined();
    }
    expect(
      await tarjetaPorTelefono(comercioId, telefono),
      'el monto faltante se resuelve tecleando el dato: no debió crear ni cliente ni tarjeta',
    ).toBeNull();
  });

  it('con 999 centavos (mínimo $10.00): ok:false, bloqueoLimite, error EXACTO del mínimo, la tarjeta SÍ existe con saldo 0', async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);
    const telefono = telefonoUnico();

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono,
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
      montoCompraCentavos: 999,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('La compra mínima para sumar es $10.00.');
      expect(res.bloqueoLimite).toBe(true);
    }
    const tarjeta = await tarjetaPorTelefono(comercioId, telefono);
    expect(tarjeta, 'el mínimo se rechaza CON la tarjeta ya creada, mismo contrato que las perillas antifraude').not.toBeNull();
    expect(tarjeta?.puntos_actuales, 'el intento bajo el mínimo no puede haber escrito nada').toBe(0);
  });

  it('con 1000 centavos (el mínimo es inclusivo): ok:true, saldo 1, y el ledger guarda monto_compra = 10', async () => {
    const comercioId = await comercioDeSellosConMinimo();
    const programaId = entorno.obtenerProgramaPrincipal(comercioId);

    const res = await altaYAcreditacionPorTelefono(supabase, comercioId, {
      telefono: telefonoUnico(),
      nombre: 'Cliente Delivery',
      programaId,
      cantidad: 1,
      montoCompraCentavos: 1000,
    });

    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    if (!res.ok) return;
    expect(res.puntosActuales).toBe(1);

    const transaccion = await primeraTransaccionDe(res.tarjetaId);
    expect(Number(transaccion?.monto_compra), 'la compra que originó el sello, en dólares').toBe(10);
  });
});
