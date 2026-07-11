// Tipos de la base de datos para el cliente de Supabase.
//
// TRANSCRITOS A MANO desde las migraciones (fuente de verdad):
//   - supabase/migrations/0001_esquema_inicial.sql
//   - supabase/migrations/0002_rls_clientes_e_indice_dispositivos.sql (RLS + índice; no cambia columnas)
//
// Hasta que `supabase gen types` esté cableado (requiere auth del CLI), este archivo se
// mantiene a mano: si llega una migración nueva, hay que actualizarlo en el mismo commit.
//
// Convenciones de transcripción: uuid/text -> string, integer/numeric -> number,
// boolean -> boolean, timestamptz -> string. Columna nullable -> `| null` en Row y opcional
// en Insert. Columna con default en la BD -> opcional en Insert.

export type Database = {
  public: {
    Tables: {
      comercios: {
        Row: {
          id: string;
          nombre: string;
          slug: string;
          color_fondo: string | null;
          color_texto: string | null;
          color_label: string | null;
          logo_url: string | null;
          strip_url: string | null;
          hero_url: string | null;
          google_class_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          slug: string;
          color_fondo?: string | null;
          color_texto?: string | null;
          color_label?: string | null;
          logo_url?: string | null;
          strip_url?: string | null;
          hero_url?: string | null;
          google_class_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          slug?: string;
          color_fondo?: string | null;
          color_texto?: string | null;
          color_label?: string | null;
          logo_url?: string | null;
          strip_url?: string | null;
          hero_url?: string | null;
          google_class_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      usuarios_comercio: {
        Row: {
          id: string;
          comercio_id: string;
          email: string;
          rol: string;
          auth_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          email: string;
          rol: string;
          auth_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          email?: string;
          rol?: string;
          auth_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      clientes: {
        Row: {
          id: string;
          nombre: string;
          telefono: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          telefono: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          telefono?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      tarjetas: {
        Row: {
          id: string;
          cliente_id: string;
          comercio_id: string;
          puntos_actuales: number;
          qr_token: string;
          apple_serial_number: string | null;
          apple_auth_token: string | null;
          google_object_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cliente_id: string;
          comercio_id: string;
          puntos_actuales?: number;
          qr_token?: string;
          apple_serial_number?: string | null;
          apple_auth_token?: string | null;
          google_object_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          cliente_id?: string;
          comercio_id?: string;
          puntos_actuales?: number;
          qr_token?: string;
          apple_serial_number?: string | null;
          apple_auth_token?: string | null;
          google_object_id?: string | null;
          created_at?: string;
        };
        // FK inline en la migración 0001 (`references comercios(id)`) — Postgres la nombra
        // `tarjetas_comercio_id_fkey`. Necesaria para que el join embebido `comercios(*)`
        // resuelva su tipo (sin la entrada, .select('*, comercios(*)') da SelectQueryError).
        Relationships: [
          {
            foreignKeyName: 'tarjetas_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
        ];
      };
      reglas_puntos: {
        Row: {
          id: string;
          comercio_id: string;
          tipo: string;
          valor: number;
          activa_desde: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          tipo: string;
          valor: number;
          activa_desde?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          tipo?: string;
          valor?: number;
          activa_desde?: string;
        };
        Relationships: [];
      };
      recompensas: {
        Row: {
          id: string;
          comercio_id: string;
          nombre: string;
          descripcion: string | null;
          foto_url: string | null;
          costo_puntos: number;
          tipo: string;
          valor: string | null;
          activa: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          nombre: string;
          descripcion?: string | null;
          foto_url?: string | null;
          costo_puntos: number;
          tipo: string;
          valor?: string | null;
          activa?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          nombre?: string;
          descripcion?: string | null;
          foto_url?: string | null;
          costo_puntos?: number;
          tipo?: string;
          valor?: string | null;
          activa?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      transacciones_puntos: {
        Row: {
          id: string;
          tarjeta_id: string;
          cajero_usuario_id: string | null;
          puntos_delta: number;
          monto_compra: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          cajero_usuario_id?: string | null;
          puntos_delta: number;
          monto_compra?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          cajero_usuario_id?: string | null;
          puntos_delta?: number;
          monto_compra?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      canjes: {
        Row: {
          id: string;
          tarjeta_id: string;
          recompensa_id: string;
          cajero_usuario_id: string | null;
          puntos_gastados: number;
          estado: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          recompensa_id: string;
          cajero_usuario_id?: string | null;
          puntos_gastados: number;
          estado?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          recompensa_id?: string;
          cajero_usuario_id?: string | null;
          puntos_gastados?: number;
          estado?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      apple_push_registrations: {
        Row: {
          id: string;
          tarjeta_id: string;
          device_library_identifier: string;
          push_token: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          device_library_identifier: string;
          push_token: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          device_library_identifier?: string;
          push_token?: string;
          created_at?: string;
        };
        // FK inline en la migración 0001 (`tarjeta_id ... references tarjetas(id)`) — Postgres la
        // nombra `apple_push_registrations_tarjeta_id_fkey`. Necesaria para que el join embebido
        // `tarjetas(apple_serial_number)` resuelva su tipo (sin la entrada da SelectQueryError).
        Relationships: [
          {
            foreignKeyName: 'apple_push_registrations_tarjeta_id_fkey';
            columns: ['tarjeta_id'];
            isOneToOne: false;
            referencedRelation: 'tarjetas';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    // Secciones vacías en la forma canónica de `supabase gen types` ({ [_ in never]: never }).
    // OJO: NO usar Record<string, never> aquí — su keyof es string y abre un agujero en el
    // overload de .from()/.rpc() que aceptaría cualquier nombre de tabla/función.
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
