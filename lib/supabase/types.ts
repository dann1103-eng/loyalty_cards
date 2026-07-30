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
//   - supabase/migrations/0011_plan_cuenta.sql (licencia_estado/plan/monto_mensual/activa_desde: de comercios a cuentas_comercio; limite_negocios pasa a nullable)
//   - supabase/migrations/0012_sucursal_principal.sql (sucursales.es_principal + índice único parcial)
//   - supabase/migrations/0013_reverso_tarjeta.sql (columnas del reverso del pass en comercios)
//   - supabase/migrations/0014_prospectos.sql (tabla prospectos, formulario de la página pública)
//   - supabase/migrations/0026_notificaciones_push.sql (tablas difusiones y notificaciones_enviadas; tarjetas.aviso_texto/aviso_hasta/aviso_inactividad_enviado_en; comercios.aviso_inactividad_activo/dias/mensaje)
//   - supabase/migrations/0025_backfill_programas_principales_faltantes.sql (solo datos, no cambia columnas: programa principal para comercios que la 0024 no alcanzó a cubrir)
//   - supabase/migrations/0024_programas_de_tarjeta.sql (tabla programas_tarjeta; tarjetas.programa_id NOT NULL; unique (cliente_id, programa_id) reemplaza unique (cliente_id, comercio_id))
//   - supabase/migrations/0023_registrar_compra_descuento.sql (funcion registrar_compra_atomico)
//   - supabase/migrations/0022_consumir_saldo.sql (funcion consumir_saldo_atomico)
//   - supabase/migrations/0021_campana_con_vencimiento.sql (mensaje_campana/campana_hasta en sucursales)
//   - supabase/migrations/0020_usar_visita_multipass.sql (funcion usar_visita_atomico)
//   - supabase/migrations/0019_vigencia_cupon_membresia.sql (tipos 'uso'/'renovacion' en el ledger; funciones usar_cupon_atomico/renovar_membresia_atomico)
//   - supabase/migrations/0018_tipos_de_tarjeta.sql (config por tipo en comercios; vigencia_hasta/usado_en/acumulado_centavos en tarjetas; tabla niveles_descuento)
//   - supabase/migrations/0017_plan_y_cobros.sql (tablas solicitudes_plan y cobros)
//   - supabase/migrations/0016_geopush_sucursales.sql (latitud/longitud/mensaje_cercania/geopush_activo en sucursales)
//   - supabase/migrations/0015_antifraude_control_sellos.sql (tipo/motivo/forzado en transacciones_puntos; perillas de control, pedir_monto_compra y zona_horaria en comercios; funciones acreditar_atomico/acreditar_forzado_atomico/ajustar_puntos_atomico/historial_tarjeta/reporte_cajeros en Functions)
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
          tipo_tarjeta: string;
          sello_icono_url: string | null;
          sello_meta: number | null;
          difuminado_franja: string;
          cuenta_id: string | null;
          // Reverso configurable del pass (migración 0013). La sección "Cómo funciona" NO vive acá:
          // se arma en cada generación desde reglas_puntos y recompensas, para que no pueda quedar
          // prometiendo una recompensa que el dueño ya cambió.
          terminos_uso: string | null;
          red_instagram: string | null;
          red_facebook: string | null;
          red_whatsapp: string | null;
          sitio_web: string | null;
          mostrar_como_funciona: boolean;
          // Control de acreditación (migración 0015). Las cuatro perillas son `null` = sin límite,
          // que es como nacen TODOS los comercios: el escáner no cambia de comportamiento hasta que
          // el dueño configure algo. Las dos de puntos solo tienen sentido con tipo_tarjeta='puntos'.
          tope_acreditaciones_dia: number | null;
          espera_minima_minutos: number | null;
          techo_puntos_acreditacion: number | null;
          tope_puntos_dia: number | null;
          pedir_monto_compra: boolean;
          // Define el corte del día del tope diario y de reporte_tendencia. La BD tiene un CHECK de
          // lista cerrada: los valores válidos son los de ZONAS_HORARIAS en lib/comercio/zonasHorarias.ts,
          // y las dos listas se mueven JUNTAS o la UI ofrece un valor que la BD rechaza con 23514.
          zona_horaria: string;
          // Configuración de los tipos de tarjeta (migración 0018). Cada una solo aplica a su tipo;
          // null = sin configurar. Se dejan en comercios y no en una tabla aparte porque son un
          // puñado de escalares por comercio, no una relación.
          cashback_porcentaje: number | null;
          multipass_visitas: number | null;
          membresia_dias: number | null;
          cupon_vigencia_dias: number | null;
          // Aviso de inactividad (migración 0026), mismo criterio que las perillas antifraude:
          // null/false = apagado, el comportamiento no cambia hasta que el dueño lo configure.
          aviso_inactividad_activo: boolean;
          aviso_inactividad_dias: number | null;
          aviso_inactividad_mensaje: string | null;
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
          tipo_tarjeta?: string;
          sello_icono_url?: string | null;
          sello_meta?: number | null;
          difuminado_franja?: string;
          cuenta_id?: string | null;
          terminos_uso?: string | null;
          red_instagram?: string | null;
          red_facebook?: string | null;
          red_whatsapp?: string | null;
          sitio_web?: string | null;
          mostrar_como_funciona?: boolean;
          tope_acreditaciones_dia?: number | null;
          espera_minima_minutos?: number | null;
          techo_puntos_acreditacion?: number | null;
          tope_puntos_dia?: number | null;
          pedir_monto_compra?: boolean;
          zona_horaria?: string;
          cashback_porcentaje?: number | null;
          multipass_visitas?: number | null;
          membresia_dias?: number | null;
          cupon_vigencia_dias?: number | null;
          aviso_inactividad_activo?: boolean;
          aviso_inactividad_dias?: number | null;
          aviso_inactividad_mensaje?: string | null;
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
          tipo_tarjeta?: string;
          sello_icono_url?: string | null;
          sello_meta?: number | null;
          difuminado_franja?: string;
          cuenta_id?: string | null;
          terminos_uso?: string | null;
          red_instagram?: string | null;
          red_facebook?: string | null;
          red_whatsapp?: string | null;
          sitio_web?: string | null;
          mostrar_como_funciona?: boolean;
          tope_acreditaciones_dia?: number | null;
          espera_minima_minutos?: number | null;
          techo_puntos_acreditacion?: number | null;
          tope_puntos_dia?: number | null;
          pedir_monto_compra?: boolean;
          zona_horaria?: string;
          cashback_porcentaje?: number | null;
          multipass_visitas?: number | null;
          membresia_dias?: number | null;
          cupon_vigencia_dias?: number | null;
          aviso_inactividad_activo?: boolean;
          aviso_inactividad_dias?: number | null;
          aviso_inactividad_mensaje?: string | null;
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
          // Migración 0024: qué programa de este comercio emitió la tarjeta. NOT NULL sin default —
          // toda tarjeta nueva DEBE nacer con programa_id (registrarCliente.ts), no hay valor que
          // la BD pueda inventar sola. tipo_tarjeta/la configuración por tipo ahora viven en
          // programas_tarjeta, no en comercios.
          programa_id: string;
          // CONTADOR UNIVERSAL (migración 0018): su significado depende de programas_tarjeta.tipo_tarjeta
          // (antes, de comercios.tipo_tarjeta). En sellos son sellos; en multipass, visitas restantes;
          // en cashback y gift_card, CENTAVOS. Nunca imprimirlo crudo — pasar siempre por
          // describirSaldo (lib/tarjetas/tipos.ts).
          puntos_actuales: number;
          qr_token: string;
          apple_serial_number: string | null;
          apple_auth_token: string | null;
          google_object_id: string | null;
          created_at: string;
          // Membresía y cupón (0018). Fecha y no timestamp: "vence el 30" es el 30 completo en el
          // local, no un instante que se corre con la zona horaria.
          vigencia_hasta: string | null;
          // Cupón: cuándo se usó. null = disponible. Se guarda el instante y no un booleano porque
          // "cuándo lo usó" es el dato que mide la campaña.
          usado_en: string | null;
          // Descuento por nivel: gasto histórico en centavos. NUNCA baja.
          acumulado_centavos: number;
          // Migración 0026: estado ACTUAL del aviso (campaña o inactividad) en el reverso del
          // pase. construirReverso lo lee en CADA regeneración — no solo la que lo originó.
          aviso_texto: string | null;
          aviso_hasta: string | null;
          // Cuándo se mandó el último aviso de inactividad a ESTA tarjeta, para no repetirlo cada
          // día una vez cruzado el umbral.
          aviso_inactividad_enviado_en: string | null;
        };
        Insert: {
          id?: string;
          cliente_id: string;
          comercio_id: string;
          programa_id: string;
          puntos_actuales?: number;
          qr_token?: string;
          apple_serial_number?: string | null;
          apple_auth_token?: string | null;
          google_object_id?: string | null;
          created_at?: string;
          vigencia_hasta?: string | null;
          usado_en?: string | null;
          acumulado_centavos?: number;
          aviso_texto?: string | null;
          aviso_hasta?: string | null;
          aviso_inactividad_enviado_en?: string | null;
        };
        Update: {
          id?: string;
          cliente_id?: string;
          comercio_id?: string;
          programa_id?: string;
          puntos_actuales?: number;
          qr_token?: string;
          apple_serial_number?: string | null;
          apple_auth_token?: string | null;
          google_object_id?: string | null;
          created_at?: string;
          vigencia_hasta?: string | null;
          usado_en?: string | null;
          acumulado_centavos?: number;
          aviso_texto?: string | null;
          aviso_hasta?: string | null;
          aviso_inactividad_enviado_en?: string | null;
        };
        // FKs inline en la migración 0001 (`references comercios(id)` / `references clientes(id)`)
        // — Postgres las nombra `tarjetas_comercio_id_fkey` / `tarjetas_cliente_id_fkey`. Necesarias
        // para que los joins embebidos `comercios(*)` (pass) y `clientes(nombre, telefono)`
        // (directorio de clientes) resuelvan su tipo; sin la entrada dan SelectQueryError. La de
        // programa_id (0024) sigue el mismo motivo, para `programas_tarjeta(...)` desde el escáner.
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
          {
            foreignKeyName: 'tarjetas_programa_id_fkey';
            columns: ['programa_id'];
            isOneToOne: false;
            referencedRelation: 'programas_tarjeta';
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
          // Existe desde la 0001 pero recién la 0015 la escribe, y solo si el comercio activó
          // pedir_monto_compra. En las filas anteriores a esa fecha es siempre null.
          monto_compra: number | null;
          sucursal_id: string | null;
          created_at: string;
          // Clasificación del ledger (migración 0015). 'acreditacion' | 'ajuste'. Todo el histórico
          // anterior queda en 'acreditacion' por el default, y las cuatro funciones de reporte
          // filtran por ese valor para que una corrección no cuente como visita.
          tipo: string;
          // Obligatorio cuando tipo='ajuste' o forzado=true (CHECK en la BD + validación en TS).
          motivo: string | null;
          // true = el dueño autorizó esta acreditación saltándose un límite. El camino del cajero
          // (acreditar_atomico) es físicamente incapaz de escribir true acá.
          forzado: boolean;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          cajero_usuario_id?: string | null;
          puntos_delta: number;
          monto_compra?: number | null;
          sucursal_id?: string | null;
          created_at?: string;
          tipo?: string;
          motivo?: string | null;
          forzado?: boolean;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          cajero_usuario_id?: string | null;
          puntos_delta?: number;
          monto_compra?: number | null;
          sucursal_id?: string | null;
          created_at?: string;
          tipo?: string;
          motivo?: string | null;
          forzado?: boolean;
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
      // Migración 0014: los datos que deja un comercio interesado en la página pública. `correo` y
      // `telefono` son nullable en la BD, pero la validación de la app exige AL MENOS UNO: un
      // prospecto sin forma de contactarlo no sirve para nada.
      prospectos: {
        Row: {
          id: string;
          nombre: string;
          negocio: string;
          correo: string | null;
          telefono: string | null;
          mensaje: string | null;
          origen: string | null;
          atendido: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          negocio: string;
          correo?: string | null;
          telefono?: string | null;
          mensaje?: string | null;
          origen?: string | null;
          atendido?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          negocio?: string;
          correo?: string | null;
          telefono?: string | null;
          mensaje?: string | null;
          origen?: string | null;
          atendido?: boolean;
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
          // null = sin límite (plan Pro). Antes NOT NULL (Fase 6) — migración 0011 lo relaja.
          limite_negocios: number | null;
          plan: string | null;
          licencia_estado: string;
          licencia_monto_mensual: number | null;
          licencia_activa_desde: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          limite_negocios?: number | null;
          plan?: string | null;
          licencia_estado?: string;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          nombre?: string;
          limite_negocios?: number | null;
          plan?: string | null;
          licencia_estado?: string;
          licencia_monto_mensual?: number | null;
          licencia_activa_desde?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migración 0008: sucursales de un comercio (comparten su tarjeta/branding/QR).
      solicitudes_plan: {
        Row: {
          id: string;
          cuenta_id: string;
          // El plan que la cuenta tenía AL SOLICITAR. Sin él, leer una solicitud vieja no dice de
          // dónde venía (el plan actual pudo cambiar desde entonces).
          plan_actual: string;
          plan_solicitado: string;
          motivo: string | null;
          estado: string;
          comentario_fm: string | null;
          // La BD garantiza que esté presente si y solo si el estado NO es 'pendiente'.
          resuelta_en: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cuenta_id: string;
          plan_actual: string;
          plan_solicitado: string;
          motivo?: string | null;
          estado?: string;
          comentario_fm?: string | null;
          resuelta_en?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          cuenta_id?: string;
          plan_actual?: string;
          plan_solicitado?: string;
          motivo?: string | null;
          estado?: string;
          comentario_fm?: string | null;
          resuelta_en?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'solicitudes_plan_cuenta_id_fkey';
            columns: ['cuenta_id'];
            isOneToOne: false;
            referencedRelation: 'cuentas_comercio';
            referencedColumns: ['id'];
          },
        ];
      };
      niveles_descuento: {
        Row: {
          id: string;
          comercio_id: string;
          // Umbral de gasto acumulado a partir del cual aplica este porcentaje.
          desde_centavos: number;
          porcentaje: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          desde_centavos: number;
          porcentaje: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          desde_centavos?: number;
          porcentaje?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'niveles_descuento_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
        ];
      };
      cobros: {
        Row: {
          id: string;
          // Correlativo global generado por la BD (identity). Puede tener HUECOS: una secuencia de
          // Postgres no retrocede cuando un insert falla. No es una serie fiscal, así que da igual.
          numero: number;
          cuenta_id: string;
          periodo_desde: string;
          periodo_hasta: string;
          monto: number;
          estado: string;
          metodo: string | null;
          nota: string | null;
          // La BD garantiza que esté presente si y solo si el estado es 'pagado'.
          pagado_en: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cuenta_id: string;
          periodo_desde: string;
          periodo_hasta: string;
          monto: number;
          estado?: string;
          metodo?: string | null;
          nota?: string | null;
          pagado_en?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          cuenta_id?: string;
          periodo_desde?: string;
          periodo_hasta?: string;
          monto?: number;
          estado?: string;
          metodo?: string | null;
          nota?: string | null;
          pagado_en?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cobros_cuenta_id_fkey';
            columns: ['cuenta_id'];
            isOneToOne: false;
            referencedRelation: 'cuentas_comercio';
            referencedColumns: ['id'];
          },
        ];
      };
      sucursales: {
        Row: {
          id: string;
          comercio_id: string;
          nombre: string;
          activa: boolean;
          // Migración 0012: la sucursal que representa al local del propio comercio. No consume
          // cupo del plan y no se puede desactivar (ambas reglas viven en la capa app). La BD solo
          // garantiza que haya como máximo UNA por comercio (índice parcial único).
          es_principal: boolean;
          created_at: string;
          // Geopush (migración 0016). numeric en la BD → number acá. Nullable: una sucursal sin
          // coordenadas es un estado normal (recién creada, o el dueño no las cargó todavía).
          latitud: number | null;
          longitud: number | null;
          // Texto de la pantalla de bloqueo en iPhone (relevantText de PassKit). Máx. 128 — Apple
          // no rechaza un texto más largo, lo CORTA en silencio. En Android no se usa: ahí el texto
          // lo pone Google y no se puede editar.
          // Mensaje BASE: permanente, describe al negocio.
          mensaje_cercania: string | null;
          // Campaña temporal (migración 0021): TAPA al base mientras vive y se apaga sola al vencer.
          // La BD exige que mensaje_campana y campana_hasta vayan los dos o ninguno.
          mensaje_campana: string | null;
          campana_hasta: string | null;
          // Qué sucursales participan del geopush. Apple admite 10 ubicaciones por pase y el tope
          // se valida en lib/comercio/sucursales.ts (la BD no expresa "máximo N").
          geopush_activo: boolean;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          nombre: string;
          activa?: boolean;
          es_principal?: boolean;
          created_at?: string;
          latitud?: number | null;
          longitud?: number | null;
          mensaje_cercania?: string | null;
          mensaje_campana?: string | null;
          campana_hasta?: string | null;
          geopush_activo?: boolean;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          nombre?: string;
          activa?: boolean;
          es_principal?: boolean;
          created_at?: string;
          latitud?: number | null;
          longitud?: number | null;
          mensaje_cercania?: string | null;
          mensaje_campana?: string | null;
          campana_hasta?: string | null;
          geopush_activo?: boolean;
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
      programas_tarjeta: {
        Row: {
          id: string;
          comercio_id: string;
          nombre: string;
          // Para /registro/<comercioSlug>/<slug>. Único por comercio, no global (a diferencia de
          // comercios.slug) — dos comercios distintos pueden cada uno tener un programa "principal".
          slug: string;
          tipo_tarjeta: string;
          // Máximo UNO en true por comercio (índice único parcial). El que recibe quien escanea el
          // QR viejo del comercio, sin programa en la URL.
          es_principal: boolean;
          // Soft-delete: las tarjetas emitidas lo referencian. Mismo criterio que recompensas/cajeros.
          activo: boolean;
          // Configuración por tipo, mudada desde comercios (migración 0018 → 0024). Cada campo solo
          // aplica a un tipo — ver lib/comercio/programas.ts.
          sello_meta: number | null;
          cashback_porcentaje: number | null;
          multipass_visitas: number | null;
          membresia_dias: number | null;
          cupon_vigencia_dias: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          nombre: string;
          slug: string;
          tipo_tarjeta: string;
          es_principal?: boolean;
          activo?: boolean;
          sello_meta?: number | null;
          cashback_porcentaje?: number | null;
          multipass_visitas?: number | null;
          membresia_dias?: number | null;
          cupon_vigencia_dias?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          nombre?: string;
          slug?: string;
          tipo_tarjeta?: string;
          es_principal?: boolean;
          activo?: boolean;
          sello_meta?: number | null;
          cashback_porcentaje?: number | null;
          multipass_visitas?: number | null;
          membresia_dias?: number | null;
          cupon_vigencia_dias?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'programas_tarjeta_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
        ];
      };
      difusiones: {
        Row: {
          id: string;
          comercio_id: string;
          // null = todos los programas activos del comercio.
          programa_id: string | null;
          mensaje: string;
          // Cuánto dura el mensaje en el reverso del pase — lo elige el dueño, igual que
          // campana_hasta en geopush (0021).
          vigente_hasta: string;
          creada_por: string;
          creada_en: string;
          // Tarjetas alcanzadas por AL MENOS un canal (no el tamaño de la lista resuelta).
          destinatarios: number;
        };
        Insert: {
          id?: string;
          comercio_id: string;
          programa_id?: string | null;
          mensaje: string;
          vigente_hasta: string;
          creada_por: string;
          creada_en?: string;
          destinatarios?: number;
        };
        Update: {
          id?: string;
          comercio_id?: string;
          programa_id?: string | null;
          mensaje?: string;
          vigente_hasta?: string;
          creada_por?: string;
          creada_en?: string;
          destinatarios?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'difusiones_comercio_id_fkey';
            columns: ['comercio_id'];
            isOneToOne: false;
            referencedRelation: 'comercios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'difusiones_programa_id_fkey';
            columns: ['programa_id'];
            isOneToOne: false;
            referencedRelation: 'programas_tarjeta';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'difusiones_creada_por_fkey';
            columns: ['creada_por'];
            isOneToOne: false;
            referencedRelation: 'usuarios_comercio';
            referencedColumns: ['id'];
          },
        ];
      };
      notificaciones_enviadas: {
        Row: {
          id: string;
          tarjeta_id: string;
          canal: string;
          origen: string;
          // Solo cuando origen='campana'; null en 'inactividad'.
          difusion_id: string | null;
          enviada_en: string;
        };
        Insert: {
          id?: string;
          tarjeta_id: string;
          canal: string;
          origen: string;
          difusion_id?: string | null;
          enviada_en?: string;
        };
        Update: {
          id?: string;
          tarjeta_id?: string;
          canal?: string;
          origen?: string;
          difusion_id?: string | null;
          enviada_en?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notificaciones_enviadas_tarjeta_id_fkey';
            columns: ['tarjeta_id'];
            isOneToOne: false;
            referencedRelation: 'tarjetas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notificaciones_enviadas_difusion_id_fkey';
            columns: ['difusion_id'];
            isOneToOne: false;
            referencedRelation: 'difusiones';
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
      // Migración 0015: antifraude y control de sellos. Mismo criterio que las anteriores —
      // `returns table(...)` ⇒ `Returns` es `[]` y los wrappers leen `data?.[0]` (o la lista entera,
      // en el caso de historial_tarjeta y reporte_cajeros).
      //
      // acreditar_atomico REEMPLAZA en la práctica a acreditar_puntos_atomico, que queda arriba
      // como wrapper de compatibilidad de 5 argumentos hasta que el deploy nuevo esté en producción.
      // El código nuevo llama SIEMPRE a acreditar_atomico.
      acreditar_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_delta: number;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
          p_monto_compra: number | null;
        };
        Returns: {
          estado: string;
          saldo: number;
        }[];
      };
      acreditar_forzado_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_delta: number;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
          p_monto_compra: number | null;
          p_motivo: string;
        };
        Returns: {
          estado: string;
          saldo: number;
        }[];
      };
      ajustar_puntos_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_delta: number;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
          p_motivo: string;
        };
        Returns: {
          estado: string;
          saldo: number;
        }[];
      };
      // Historial de UNA tarjeta: union de transacciones_puntos y canjes con el saldo corrido.
      // `clase` es 'acreditacion' | 'ajuste' | 'canje'. Los nombres de las columnas de salida NO
      // coinciden con los de las tablas a propósito (ocurrio_en, motivo_texto, fue_forzado, monto):
      // en `language sql`, una columna homónima le gana a la variable OUT en silencio.
      historial_tarjeta: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_limite: number | null;
          p_desde: string | null;
        };
        Returns: {
          movimiento_id: string;
          ocurrio_en: string;
          clase: string;
          delta: number;
          saldo_resultante: number;
          sucursal_nombre: string | null;
          cajero_email: string | null;
          motivo_texto: string | null;
          fue_forzado: boolean;
          monto: number | null;
          recompensa_nombre: string | null;
        }[];
      };
      // p_desde/p_hasta son `date` (llegan como 'AAAA-MM-DD') e INCLUSIVOS, interpretados en la
      // zona horaria del comercio. null en cualquiera = sin ese borde.
      // Migración 0019: cupón y membresía. Devuelven una FECHA y no un saldo — su estado no es un
      // número. `vencia`/`vence` llegan como 'AAAA-MM-DD'.
      // Migración 0020: consumir una visita de multipass. Vender el paquete NO tiene función propia
      // — reusa acreditar_atomico, que ya suma al contador con auditoría y límites.
      // Migración 0022: gastar saldo (gift card y cashback). `p_monto` va en CENTAVOS, igual que el
      // contador. Cargar saldo y acreditar cashback NO tienen función propia: reusan acreditar_atomico.
      // Migración 0023: descuento por nivel. Suma al gasto HISTÓRICO (acumulado_centavos), que nunca
      // baja; el nivel se calcula al leer y nunca se guarda.
      registrar_compra_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_monto_centavos: number;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: { estado: string; acumulado: number }[];
      };
      consumir_saldo_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_monto: number;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: { estado: string; saldo: number }[];
      };
      usar_visita_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: { estado: string; saldo: number }[];
      };
      usar_cupon_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: { estado: string; vencia: string | null }[];
      };
      renovar_membresia_atomico: {
        Args: {
          p_comercio_id: string;
          p_tarjeta_id: string;
          p_sucursal_id: string | null;
          p_cajero_usuario_id: string | null;
        };
        Returns: { estado: string; vence: string | null }[];
      };
      reporte_cajeros: {
        Args: {
          p_comercio_id: string;
          p_desde: string | null;
          p_hasta: string | null;
        };
        Returns: {
          cajero_usuario_id: string | null;
          cajero_email: string | null;
          cajero_activo: boolean | null;
          acreditaciones: number;
          puntos_otorgados: number;
          monto_total: number;
          forzadas: number;
          ajustes: number;
          puntos_ajustados: number;
          canjes: number;
          clientes_unicos: number;
        }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
