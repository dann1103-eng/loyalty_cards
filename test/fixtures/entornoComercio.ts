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
  crearTarjeta(comercioId: string, puntos?: number): Promise<{ id: string; qrToken: string }>;
  crearSucursal(comercioId: string, activa?: boolean): Promise<string>;
  crearCajero(comercioId: string): Promise<string>;
  crearRecompensa(comercioId: string, costo: number): Promise<string>;
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

  return {
    async crearComercio(campos) {
      const { data, error } = await supabase
        .from('comercios')
        .insert({ nombre: 'Comercio Prueba', slug: `test-tanda1-${sufijoUnico()}`, ...campos })
        .select('id')
        .single();
      if (error) throw error;
      comercios.push(data.id);
      return data.id;
    },

    async crearTarjeta(comercioId, puntos = 0) {
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
          puntos_actuales: puntos,
          qr_token: `test-tok-${sufijoUnico()}`,
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
        tabla: 'transacciones_puntos' | 'canjes' | 'usuarios_comercio' | 'sucursales' | 'tarjetas' | 'clientes' | 'comercios' | 'recompensas',
        columna: string,
        ids: string[],
      ) => {
        if (!ids.length) return;
        const { error } = await supabase.from(tabla).delete().in(columna, ids);
        if (error) console.error(`[test] no se pudo limpiar ${tabla}:`, error);
      };

      // Ledger primero: transacciones_puntos y canjes apuntan a tarjetas, sucursales y
      // usuarios_comercio. Sin esto, borrar un cajero que ya operó lanza 23503.
      await borrar('transacciones_puntos', 'tarjeta_id', tarjetas);
      await borrar('canjes', 'tarjeta_id', tarjetas);
      await borrar('usuarios_comercio', 'id', usuarios);
      await borrar('sucursales', 'id', sucursales);
      await borrar('recompensas', 'id', recompensas);
      await borrar('tarjetas', 'id', tarjetas);
      await borrar('clientes', 'id', clientes);
      await borrar('comercios', 'id', comercios);

      comercios.length = 0;
      clientes.length = 0;
      tarjetas.length = 0;
      sucursales.length = 0;
      usuarios.length = 0;
      recompensas.length = 0;
    },
  };
}
