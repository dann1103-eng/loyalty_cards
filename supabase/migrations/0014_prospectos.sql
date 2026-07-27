-- 0014: prospectos — los datos que deja un comercio interesado en la pagina publica.
--
-- La pagina raiz de cardly-sv.site le habla a duenos de negocio que todavia no son clientes. El
-- unico camino de conversion es este formulario, asi que su fila es literalmente un cliente
-- potencial: nada de lo que llegue aca se borra automaticamente.
--
-- `correo` y `telefono` son los dos nullable a proposito, pero la validacion de la aplicacion exige
-- AL MENOS UNO: un prospecto sin forma de contactarlo no sirve para nada. Esa regla vive en el
-- codigo, como el resto de este proyecto (la base casi no tiene CHECKs).
create table prospectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  negocio text not null,
  correo text,
  telefono text,
  mensaje text,
  -- Para saber por donde entro cuando haya mas de una campana. Null = trafico directo.
  origen text,
  -- Lo marca FM a mano cuando ya lo contacto, para no perder el hilo con una lista que crece.
  atendido boolean not null default false,
  created_at timestamptz not null default now()
);

-- Consulta tipica del panel de FM: los mas nuevos primero, y los que faltan atender.
create index prospectos_created_at_idx on prospectos (created_at desc);

-- Deny-all salvo service_role, igual que el resto del esquema: el formulario escribe desde el
-- servidor con la llave de servicio, nunca desde el navegador. Sin RLS, cualquiera con la llave
-- publica podria LEER los datos de contacto de todos los prospectos.
alter table prospectos enable row level security;
