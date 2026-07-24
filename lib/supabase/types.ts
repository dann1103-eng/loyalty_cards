// Tipos de la base de datos para el cliente de Supabase.
//
// TRANSCRITOS A MANO desde las migraciones (fuente de verdad):
//   - supabase/migrations/0001_esquema_inicial.sql
//   - supabase/migrations/0002_rls_clientes_e_indice_dispositivos.sql (RLS + índice; no cambia columnas)
//   - supabase/migrations/0003_usuarios_fm_y_licencias.sql (tabla usuarios_fm + columnas licencia_* en comercios)
//   - supabase/migrations/0004_licencia_fecha_y_comentario.sql (licencia_activa_desde a date; no cambia tipos de TS)
//   - supabase/migrations/0005_tipo_tarjeta_y_sellos.sql (columnas tipo_tarjeta/sello_icono_url/sello_meta en comercios)
//   - supabase/migrations/0006_intentos_consulta_portal.sql (tabla intentos_consulta_portal, rate limit del portal)
//   - supabase/migrations/0007_difuminado_franja.sql (columna difuminado_franja en comercios)
//   - supabase/migrations/0008_cuentas_sucursales_cajeros.sql (tablas cuentas_comercio/sucursales; comercios.cuenta_id; usuarios_comercio.sucursal_id; sucursal_id en transacciones_puntos/canjes)
//   - supabase/migrations/0009_rpc_atomico.sql (usuarios_comercio.activo; funciones acreditar_puntos_atomico/canjear_recompensa_atomico en Functions)
//   - supabase/migrations/0010_reportes.sql (funciones de reportes en Functions; índices; no cambia columnas)
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
          licencia_estado: string;
          licencia_plan: string | null;
          licencia_monto_mensual: number | null;
          licencia_activa_desde: string | null;
          tipo_tarjeta: string;
          sello_icono_url: string | null;
          sello_meta: number | null;
          difuminado_franja: string;
          cuenta_id: string | null;
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
          licencia_estado?: string;
          licencia_plan?: string | null;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
          tipo_tarjeta?: string;
          sello_icono_url?: string | null;
          sello_meta?: number | null;
          difuminado_franja?: string;
          cuenta_id?: string | null;
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
          licencia_estado?: string;
          licencia_plan?: string | null;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
          tipo_tarjeta?: string;
          sello_icono_url?: string | null;
          sello_meta?: number | null;
          difuminado_franja?: string;
          cuenta_id?: string | null;
        };
        // FK de la 0008 (`cuenta_id ... references cuentas_comercio(id)`). Necesaria para el join
        // embebido `cuentas_comercio(...)` desde comercios (panel FM, reportes).
        Relationships: [
          {
            foreignKeyName: 'comercios_cuenta_id_fkey';
            columns: ['cuenta_id'];
            isOneToOne: false;
            referencedRelation: 'cuentas_comercio';
            referencedColumns: ['id'];
          },
        ];
      };
      usuarios_comercio: {
        Row: {
          id: string;
          comercio_id: string;
          email: string;
          rol: string;
          auth_user_id: string | null;
          sucursal_id: string | null;
          activo: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          email: string;
          rol: string;
          auth_user_id?: string | null;
          sucursal_id?: string | null;
          activo?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          email?: string;
          rol?: string;
          auth_user_id?: string | null;
          sucursal_id?: string | null;
          activo?: boolean;
          created_at?: string;
        };
        // FKs inline: 0001 (`comercio_id → comercios`) y 0008 (`sucursal_id → sucursales`, solo
        // cajeros). La de comercio es necesaria para el join embebido `comercios(nombre)` de
        // membresiasDeUsuario/esOwnerDeComercio (sin la entrada da SelectQueryError).
        Relationships: [
          {
            foreignKeyName: 'usuarios_comercio_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'usuarios_comercio_sucursal_id_fkey';
            columns: ['sucursal_id'];
            isOneToOne: false;
            referencedRelation: 'sucursales';
            referencedColumns: ['id'];
          },
        ];
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
        // FKs inline en la migración 0001 (`references comercios(id)` / `references clientes(id)`)
        // — Postgres las nombra `tarjetas_comercio_id_fkey` / `tarjetas_cliente_id_fkey`. Necesarias
        // para que los joins embebidos `comercios(*)` (pass) y `clientes(nombre, telefono)`
        // (directorio de clientes) resuelvan su tipo; sin la entrada dan SelectQueryError.
        Relationships: [
          {
            foreignKeyName: 'tarjetas_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tarjetas_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
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
          sucursal_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          cajero_usuario_id?: string | null;
          puntos_delta: number;
          monto_compra?: number | null;
          sucursal_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          cajero_usuario_id?: string | null;
          puntos_delta?: number;
          monto_compra?: number | null;
          sucursal_id?: string | null;
          created_at?: string;
        };
        // FKs inline de la 0001 (tarjeta_id) y 0008 (sucursal_id). Necesarias para que futuros joins
        // embebidos (reportes) tipen sin SelectQueryError.
        Relationships: [
          {
            foreignKeyName: 'transacciones_puntos_tarjeta_id_fkey';
            columns: ['tarjeta_id'];
            isOneToOne: false;
            referencedRelation: 'tarjetas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transacciones_puntos_sucursal_id_fkey';
            columns: ['sucursal_id'];
            isOneToOne: false;
            referencedRelation: 'sucursales';
            referencedColumns: ['id'];
          },
        ];
      };
      canjes: {
        Row: {
          id: string;
          tarjeta_id: string;
          recompensa_id: string;
          cajero_usuario_id: string | null;
          puntos_gastados: number;
          estado: string;
          sucursal_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          recompensa_id: string;
          cajero_usuario_id?: string | null;
          puntos_gastados: number;
          estado?: string;
          sucursal_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          recompensa_id?: string;
          cajero_usuario_id?: string | null;
          puntos_gastados?: number;
          estado?: string;
          sucursal_id?: string | null;
          created_at?: string;
        };
        // FKs inline de la 0001 (tarjeta_id, recompensa_id) y 0008 (sucursal_id).
        Relationships: [
          {
            foreignKeyName: 'canjes_tarjeta_id_fkey';
            columns: ['tarjeta_id'];
            isOneToOne: false;
            referencedRelation: 'tarjetas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'canjes_recompensa_id_fkey';
            columns: ['recompensa_id'];
            isOneToOne: false;
            referencedRelation: 'recompensas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'canjes_sucursal_id_fkey';
            columns: ['sucursal_id'];
            isOneToOne: false;
            referencedRelation: 'sucursales';
            referencedColumns: ['id'];
          },
        ];
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
      usuarios_fm: {
        Row: {
          id: string;
          auth_user_id: string;
          email: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          email: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          email?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      intentos_consulta_portal: {
        Row: {
          id: string;
          ip: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ip: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ip?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migración 0008: el "cliente que paga" que agrupa comercios. limite_negocios se aplica en la
      // capa app (validar()); la BD solo garantiza el rango con un CHECK.
      cuentas_comercio: {
        Row: {
          id: string;
          nombre: string;
          limite_negocios: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          limite_negocios?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          limite_negocios?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migración 0008: sucursales de un comercio (comparten su tarjeta/branding/QR).
      sucursales: {
        Row: {
          id: string;
          comercio_id: string;
          nombre: string;
          activa: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          nombre: string;
          activa?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          nombre?: string;
          activa?: boolean;
          created_at?: string;
        };
        // FK inline de la 0008 (`comercio_id ... references comercios(id)`). Necesaria para joins
        // embebidos `comercios(...)` desde sucursales si se usan.
        Relationships: [
          {
            foreignKeyName: 'sucursales_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    // Secciones vacías en la forma canónica de `supabase gen types` ({ [_ in never]: never }).
    // OJO: NO usar Record<string, never> aquí — su keyof es string y abre un agujero en el
    // overload de .from()/.rpc() que aceptaría cualquier nombre de tabla/función.
    Views: { [_ in never]: never };
    // Migración 0009: RPC atómicos (una transacción, lock de fila) con atribución sucursal/cajero.
    // Como son `returns table(...)`, `.rpc()` devuelve `data` como ARRAY de filas — por eso `Returns`
    // es `[]` y los wrappers leen `data?.[0]`. Los p_sucursal_id/p_cajero_usuario_id son `string | null`:
    // el uuid del arg es nullable en la BD y los wrappers pasan `null` cuando no hay atribución.
    Functions: {
      acreditar_puntos_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_delta: number;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: {
          estado: string;
          saldo: number;
        }[];
      };
      canjear_recompensa_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_recompensa_id: string;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: {
          estado: string;
          saldo: number;
          nombre_recompensa: string;
          costo: number;
        }[];
      };
      // Migración 0010: funciones de reportes (BI), read-only. Como son `returns table(...)`,
      // `.rpc()` devuelve `data` como ARRAY de filas → `Returns` es `[]` (los wrappers leen las filas).
      // Los `bigint` de Postgres los serializa PostgREST como `number`. `dia` (date) llega como string.
      // Blindadas contra anon: solo service_role las ejecuta y los callers scopean por p_comercio_id del
      // gate, nunca del cliente. reporte_fm_comercios() no toma argumentos (Args vacío).
      reporte_sucursales: {
        Args: {
          p_comercio_id: string;
        };
        Returns: {
          sucursal_id: string | null;
          sucursal_nombre: string | null;
          sucursal_activa: boolean | null;
          acreditaciones: number;
          puntos_otorgados: number;
          canjes: number;
          clientes_unicos: number;
        }[];
      };
      reporte_top_clientes: {
        Args: {
          p_comercio_id: string;
          p_limite: number;
        };
        Returns: {
          cliente_id: string;
          cliente_nombre: string;
          visitas: number;
          puntos_totales: number;
        }[];
      };
      reporte_tendencia: {
        Args: {
          p_comercio_id: string;
          p_dias: number;
        };
        Returns: {
          dia: string;
          acreditaciones: number;
          canjes: number;
        }[];
      };
      reporte_fm_comercios: {
        Args: Record<PropertyKey, never>;
        Returns: {
          comercio_id: string;
          comercio_nombre: string;
          cuenta_id: string | null;
          cuenta_nombre: string | null;
          clientes: number;
          acreditaciones: number;
          canjes: number;
          saldo_circulante: number;
        }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
