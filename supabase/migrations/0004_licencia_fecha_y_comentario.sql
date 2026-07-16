-- 0004: Correcciones post-revisión de calidad de la migración 0003.
-- 0003 ya fue aplicada a la base viva; todo cambio es append-only.

-- licencia_activa_desde es semánticamente una FECHA, no un instante: "el día en que la
-- licencia entró en vigor" no tiene hora ni zona horaria significativa. Con timestamptz,
-- guardar "2026-07-16" desde un <input type="date"> almacena medianoche UTC — y al formatearlo
-- con toLocaleDateString('es-SV') (El Salvador es UTC-6) mostraría 15 de julio: un off-by-one
-- silencioso en cada fila, en cuanto alguien renderice la fecha de la forma natural.
-- Se convierte AHORA porque la columna está 100% en NULL (cero filas que convertir); con datos
-- reales del piloto exigiría decidir una zona horaria explícita.
-- El tipo de TypeScript NO cambia: PostgREST devuelve `date` como "2026-07-16" (string).
alter table comercios
  alter column licencia_activa_desde type date;

-- usuarios_fm.email es una ETIQUETA para leer en Supabase Studio, no identidad: nadie la
-- consulta (esAdminFm() empareja por auth_user_id). Es una copia de auth.users.email y puede
-- quedar desactualizada si el correo se cambia en Auth.
comment on column usuarios_fm.email is
  'Etiqueta para lectura humana en Studio. Copia de auth.users.email; puede quedar stale. NO usar para identificar: usar auth_user_id.';
