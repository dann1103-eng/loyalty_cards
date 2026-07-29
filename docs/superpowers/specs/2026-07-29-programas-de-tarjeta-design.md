# Programas de tarjeta — diseño

Fecha: 2026-07-29. Migración: `0024_programas_de_tarjeta.sql` (la primera que MUEVE datos existentes).

## Por qué

Hasta acá un comercio tiene **un** tipo de tarjeta (`comercios.tipo_tarjeta`). El dueño quiere que
cada comercio pueda ofrecer **varios programas a la vez** — por ejemplo sellos como programa
permanente y un cupón de bienvenida para una campaña — y que cada uno sea una cosa manejable:

> "El comercio configura cada tarjeta y cada tarjeta tiene un QR diferente para escanear. Puede
> haber una principal, y la otra no necesariamente la tienen que configurar en el momento sino que
> pueden dejarlo para después, y temporalmente para campañas específicas, e incluso eliminarla y
> hacer otras, y así cada una tiene su QR."

Esto REVIERTE una decisión previa. El 2026-07-28 se eligió "un tipo por comercio" sobre "varios",
con la advertencia de que la segunda opción cambia el modelo de datos de raíz. Cambiar de opinión
con información nueva es correcto; lo que sigue es lo que cuesta.

## Decisiones

1. **El límite es por COMERCIO, no por sucursal.** Las sucursales son locales de la misma marca y
   comparten los programas — es lo que ya son hoy. Dos tipos por sucursal las convertiría en
   comercios separados.
2. **Hasta 2 programas activos por comercio**, igual en los tres planes. El diferenciador entre
   planes sigue siendo la cantidad de comercios y sucursales.
3. **Cada programa tiene su propio QR de registro.** El cliente que escanea el QR de "Cupón de
   bienvenida" recibe ese programa, no todos.
4. **Un programa se puede desactivar, no borrar.** Las tarjetas emitidas lo referencian y el
   historial de cada cliente cuelga de ellas. Mismo criterio que recompensas y cajeros.

## Modelo

`programas_tarjeta`: comercio_id, nombre, slug (para la URL de registro), tipo_tarjeta,
es_principal, activo, y la configuración que HOY vive en `comercios` — `sello_meta`,
`cashback_porcentaje`, `multipass_visitas`, `membresia_dias`, `cupon_vigencia_dias`.

Esa mudanza es la parte que mejora el diseño: esa configuración nunca fue del comercio, fue del
programa. Con un solo programa por comercio la diferencia era invisible.

`tarjetas` gana `programa_id`. El `unique (cliente_id, comercio_id)` pasa a ser
`unique (cliente_id, programa_id)`: un cliente puede tener dos tarjetas en el mismo local si son de
programas distintos, pero nunca dos del mismo.

**`comercios.tipo_tarjeta` NO se borra.** Queda como el tipo del programa principal, para que el
código viejo que lo lee siga funcionando durante el despliegue. Se retira en una migración
posterior (expand → migrate → contract), igual que se hizo con `acreditar_puntos_atomico`.

## El backfill, que es lo riesgoso

Las 23 migraciones anteriores fueron aditivas. Esta reparte datos vivos:

1. Crear un programa por cada comercio existente, copiando su `tipo_tarjeta` y su configuración,
   con `es_principal = true` y el nombre del propio comercio.
2. Apuntar todas las tarjetas existentes a ese programa.
3. Recién entonces poner `programa_id` en NOT NULL.

**Guardas obligatorias**, porque una tarjeta sin programa es un cliente sin tarjeta:

- Abortar si al terminar queda alguna tarjeta con `programa_id` nulo.
- Abortar si la cantidad de tarjetas cambió.
- El `unique` viejo se reemplaza DESPUÉS del backfill, no antes.

Verificación externa: contar tarjetas por comercio antes y después de aplicar, y comparar.

## Lo que NO cambia

**Los seis motores.** `acreditar_atomico`, `usar_cupon_atomico`, `consumir_saldo_atomico` y los
demás trabajan sobre una tarjeta concreta y no leen `comercios.tipo_tarjeta`. Es la consecuencia
buena de haberlos escrito sobre la tarjeta y no sobre el comercio.

Lo que sí cambia es quién les dice qué operación corresponde: hoy el escáner lo deduce de
`comercios.tipo_tarjeta`, y pasará a deducirlo del programa de la tarjeta escaneada.

## Alcance

Migración + capa de datos + límite de 2 por plan + pantalla de programas + registro por programa +
escáner por programa de la tarjeta. El dibujo del pase, el portal y los niveles de descuento se
construyen DESPUÉS de esto, una sola vez, ya con la forma final — construirlos antes sería tirarlos.
