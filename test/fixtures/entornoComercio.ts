import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../lib/supabase/types';

// Fixtures compartidos para las pruebas de integración de la Tanda 1.
//
// Las pruebas viejas (acreditar.test.ts, canje.test.ts) tienen su propia copia inline de estos
// helpers. No se tocan: funcionan y reescribirlas sería churn sin ganancia. Este módulo existe
// porque la Tanda 1 agrega TRES archivos de prueba más, y una cuarta y quinta copia de noventa
// líneas de setup sí empieza a costar (un arreglo en el orden de borrado habría que hacerlo en
// cinco lugares).
//
// El orden de `limpiar()` respeta las FKs y es la parte que más fácil se rompe: el ledger apunta a
// tarjetas/sucursales/usuarios_comercio, usuarios_comercio apunta a sucursales Y comercios, y nada
// tiene ON DELETE CASCADE en este esquema (decisión deliberada del proyecto).

export interface EntornoComercio {
  crearComercio(campos?: Partial<Database['public']['Tables']['comercios']['Insert']>): Promise<string>;
  // `opciones` cubre los casos que antes obligaban a un insert directo (y por eso se escapaban de
  // limpiar()): una tarjeta en un programa que no es el principal, y una tarjeta con created_at
  // viejo para las pruebas de inactividad.
  crearTarjeta(
    comercioId: string,
    puntos?: number,
    opciones?: { programaId?: string; createdAt?: string },
  ): Promise<{ id: string; qrToken: string }>;
  crearSucursal(comercioId: string, activa?: boolean): Promise<string>;
  crearCajero(comercioId: string): Promise<string>;
  crearRecompensa(comercioId: string, costo: number): Promise<string>;
  // El programa principal que crearComercio() crea en automático (migración 0024). Los archivos que
  // no necesitan saberlo (la mayoría) siguen sin tocarlo; los que sí — p. ej. las pruebas de
  // programas.ts — lo usan para armar un segundo programa junto al principal.
  obtenerProgramaPrincipal(comercioId: string): string;
  limpiar(): Promise<void>;
}

function sufijoUnico(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function crearEntorno(supabase: SupabaseClient<Database>): EntornoComercio {
  const comercios: string[] = [];
  const clientes: string[] = [];
  const tarjetas: string[] = [];
  const sucursales: string[] = [];
  const usuarios: string[] = [];
  const recompensas: string[] = [];
  const programas: string[] = [];
  const programaPrincipalDe = new Map<string, string>();

  function requerirProgramaPrincipal(comercioId: string): string {
    const programaId = programaPrincipalDe.get(comercioId);
    if (!programaId) {
      throw new Error(`[test] comercio ${comercioId} no tiene programa principal — ¿se creó con crearComercio()?`);
    }
    return programaId;
  }

  return {
    async crearComercio(campos) {
      const { data, error } = await supabase
        .from('comercios')
        .insert({ nombre: 'Comercio Prueba', slug: `test-tanda1-${sufijoUnico()}`, ...campos })
        .select(
          'id, nombre, tipo_tarjeta, sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias',
        )
        .single();
      if (error) throw error;
      comercios.push(data.id);

      // Toda tarjeta necesita programa_id (migración 0024): se crea acá un programa principal,
      // transparente para los diez archivos que usan este fixture, espejando EXACTO lo que hace el
      // backfill de la 0024 — mismo tipo y configuración que quedó en el comercio (incluido lo que
      // el caller haya pasado en `campos`, p. ej. tipo_tarjeta: 'cashback').
      const { data: programa, error: eP } = await supabase
        .from('programas_tarjeta')
        .insert({
          comercio_id: data.id,
          nombre: data.nombre,
          slug: 'principal',
          tipo_tarjeta: data.tipo_tarjeta,
          es_principal: true,
          sello_meta: data.sello_meta,
          cashback_porcentaje: data.cashback_porcentaje,
          multipass_visitas: data.multipass_visitas,
          membresia_dias: data.membresia_dias,
          cupon_vigencia_dias: data.cupon_vigencia_dias,
        })
        .select('id')
        .single();
      if (eP) throw eP;
      programas.push(programa.id);
      programaPrincipalDe.set(data.id, programa.id);

      return data.id;
    },

    obtenerProgramaPrincipal(comercioId) {
      return requerirProgramaPrincipal(comercioId);
    },

    async crearTarjeta(comercioId, puntos = 0, opciones = {}) {
      // El teléfono es UNIQUE global (0001): se arma con el reloj + azar para que dos pruebas en
      // paralelo no choquen. Formato canónico +503… como exige normalizarTelefono.
      const telefono = `+503${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0')}`;
      const { data: cliente, error: eC } = await supabase
        .from('clientes')
        .insert({ nombre: 'Cliente Prueba', telefono })
        .select('id')
        .single();
      if (eC) throw eC;
      clientes.push(cliente.id);

      const { data: tarjeta, error: eT } = await supabase
        .from('tarjetas')
        .insert({
          cliente_id: cliente.id,
          comercio_id: comercioId,
          // programaId explícito para las pruebas con más de un programa (un cupón junto al
          // principal, p. ej.); sin él, el principal, que es lo que quiere la mayoría.
          programa_id: opciones.programaId ?? requerirProgramaPrincipal(comercioId),
          puntos_actuales: puntos,
          qr_token: `test-tok-${sufijoUnico()}`,
          // createdAt existe para simular una tarjeta VIEJA (aviso de inactividad). Antes de que
          // este parámetro existiera, esas pruebas hacían el insert a mano y la tarjeta quedaba
          // FUERA de los arreglos de limpiar() — 4 comercios huérfanos por corrida, en la base
          // real. Si necesitás un campo que no está acá, agregalo a este helper; no vuelvas al
          // insert directo.
          ...(opciones.createdAt ? { created_at: opciones.createdAt } : {}),
        })
        .select('id, qr_token')
        .single();
      if (eT) throw eT;
      tarjetas.push(tarjeta.id);
      return { id: tarjeta.id, qrToken: tarjeta.qr_token };
    },

    async crearSucursal(comercioId, activa = true) {
      const { data, error } = await supabase
        .from('sucursales')
        .insert({ comercio_id: comercioId, nombre: 'Sucursal Prueba', activa })
        .select('id')
        .single();
      if (error) throw error;
      sucursales.push(data.id);
      return data.id;
    },

    // Cajero mínimo: sin cuenta de Auth (auth_user_id es nullable). El RPC solo necesita que la FK
    // a usuarios_comercio(id) resuelva.
    async crearCajero(comercioId) {
      const { data, error } = await supabase
        .from('usuarios_comercio')
        .insert({
          comercio_id: comercioId,
          email: `cajero-${sufijoUnico()}@ejemplo.test`,
          rol: 'cajero',
        })
        .select('id')
        .single();
      if (error) throw error;
      usuarios.push(data.id);
      return data.id;
    },

    async crearRecompensa(comercioId, costo) {
      const { data, error } = await supabase
        .from('recompensas')
        .insert({
          comercio_id: comercioId,
          nombre: 'Premio Prueba',
          costo_puntos: costo,
          tipo: 'articulo_gratis',
        })
        .select('id')
        .single();
      if (error) throw error;
      recompensas.push(data.id);
      return data.id;
    },

    async limpiar() {
      const borrar = async (
        tabla:
          | 'transacciones_puntos'
          | 'canjes'
          | 'usuarios_comercio'
          | 'sucursales'
          | 'tarjetas'
          | 'clientes'
          | 'comercios'
          | 'recompensas'
          | 'programas_tarjeta'
          | 'notificaciones_enviadas'
          | 'difusiones',
        columna: string,
        ids: string[],
      ) => {
        if (!ids.length) return;
        const { error } = await supabase.from(tabla).delete().in(columna, ids);
        if (error) console.error(`[test] no se pudo limpiar ${tabla}:`, error);
      };

      // Ledger primero: transacciones_puntos y canjes apuntan a tarjetas, sucursales y
      // usuarios_comercio. Sin esto, borrar un cajero que ya operó lanza 23503.
      // notificaciones_enviadas y difusiones (migración 0026) NO tienen ON DELETE CASCADE, y van
      // PRIMERO por eso: notificaciones_enviadas apunta a tarjetas Y a difusiones, así que ese es
      // el orden entre las dos. difusiones apunta además a comercios, programas_tarjeta y
      // usuarios_comercio — por eso va antes que las tres.
      //
      // Sin esto el borrado falla en cascada y en SILENCIO (borrar() solo hace console.error): no
      // se puede borrar la tarjeta → no se puede borrar el comercio → queda basura permanente en
      // la base REAL. No es teórico: el 2026-07-30 había 519 "Comercio Prueba" huérfanos, y 47 de
      // ellos con aviso_inactividad_activo=true. procesarAvisosInactividad los recorría todos e
      // intentaba mandarles mensajes, y avisoInactividad.test.ts pasó de verde a 6 pruebas con
      // timeout de 20 s sin que nadie hubiera tocado esa lógica. El fallo se autoamplificaba:
      // cada corrida sumaba huérfanos y hacía más lenta la siguiente.
      // Todo lo que cuelga de un comercio se borra POR comercio_id, no por los ids que este
      // fixture fue rastreando. La diferencia importa: una prueba puede crear un hijo por su
      // cuenta —p. ej. un segundo programa con crearPrograma(), que es una función de producción y
      // no sabe nada de este fixture— y ese hijo NO está en ningún arreglo. Borrando por id, esa
      // fila sobrevive, bloquea el borrado del comercio, y como borrar() solo hace console.error
      // el fallo es SILENCIOSO: queda basura permanente en la base REAL.
      //
      // No es teórico. El 2026-07-30: 519 comercios huérfanos, 47 con aviso_inactividad_activo=true.
      // procesarAvisosInactividad los recorría todos e intentaba mandarles mensajes, y
      // avisoInactividad.test.ts pasó de verde a 6 pruebas con timeout de 20 s sin que nadie
      // tocara esa lógica. Se autoamplificaba: cada corrida sumaba huérfanos y frenaba la próxima.
      const { data: filasTarjetas } = await supabase
        .from('tarjetas')
        .select('id, cliente_id')
        .in('comercio_id', comercios);
      const idsTarjetas = [...new Set([...tarjetas, ...(filasTarjetas ?? []).map((t) => t.id)])];
      const idsClientes = [...new Set([...clientes, ...(filasTarjetas ?? []).map((t) => t.cliente_id)])];

      // notificaciones_enviadas primero de todo: apunta a tarjetas Y a difusiones (migración 0026,
      // ninguna con ON DELETE CASCADE). difusiones después, que apunta a comercios,
      // programas_tarjeta y usuarios_comercio — por eso va antes que las tres.
      await borrar('notificaciones_enviadas', 'tarjeta_id', idsTarjetas);
      await borrar('difusiones', 'comercio_id', comercios);
      await borrar('transacciones_puntos', 'tarjeta_id', idsTarjetas);
      await borrar('canjes', 'tarjeta_id', idsTarjetas);
      await borrar('usuarios_comercio', 'comercio_id', comercios);
      await borrar('sucursales', 'comercio_id', comercios);
      await borrar('recompensas', 'comercio_id', comercios);
      // tarjetas ANTES que programas_tarjeta (tarjetas.programa_id la referencia); programas_tarjeta
      // ANTES que comercios (programas_tarjeta.comercio_id lo referencia). clientes no se relaciona
      // con ninguna de las dos, así que su posición entre medio no importa.
      // idsTarjetas ya es la UNIÓN (rastreadas + las del comercio), así que cubre las dos vías.
      await borrar('tarjetas', 'id', idsTarjetas);
      // Doble pasada para programas: por comercio_id caen los que creó la prueba por su cuenta
      // (crearPrograma), y por id los que rastreó el fixture aunque su comercio ya no esté.
      await borrar('programas_tarjeta', 'comercio_id', comercios);
      await borrar('programas_tarjeta', 'id', programas);
      await borrar('clientes', 'id', idsClientes);
      await borrar('comercios', 'id', comercios);

      comercios.length = 0;
      clientes.length = 0;
      tarjetas.length = 0;
      sucursales.length = 0;
      usuarios.length = 0;
      recompensas.length = 0;
      programas.length = 0;
      programaPrincipalDe.clear();
    },
  };
}
