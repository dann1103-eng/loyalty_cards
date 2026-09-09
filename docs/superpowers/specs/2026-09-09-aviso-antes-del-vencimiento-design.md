# Aviso antes del vencimiento, y los tres pendientes que quedaban

Fecha: 2026-09-09
Estado: decisiones tomadas por el usuario en conversación; pendiente de revisión y plan

## Por qué

Daniel vende **membresías**. El único aviso automático que existe hoy se dispara por
**INACTIVIDAD** (`lib/comercio/avisoInactividad.ts`), y ese disparador no sirve para su negocio:
**un socio que renovó ayer y viene todas las semanas no está inactivo, y sin embargo su membresía
se le vence igual.** El momento en que el aviso vale plata es *antes* de la fecha, no después de un
mes sin aparecer.

Es la pieza que quedó anotada como "fuera de alcance" en las dos entregas anteriores, con esta
nota: *"es lo que de verdad necesita un negocio de membresías"*. Este spec la construye, junto con
los otros dos pendientes de código que quedaron abiertos.

## Lo que ya existe y NO se reinventa

El sistema de notificaciones está completo desde la migración 0026. Este trabajo agrega un
**disparador nuevo**, no un canal nuevo:

- `enviarMensajeTarjeta(supabase, tarjetaId, mensaje, vigenteHasta, origen, difusionId?)` manda a
  las dos billeteras y audita en `notificaciones_enviadas`.
- `tarjetas.aviso_texto` / `aviso_hasta` son el estado del aviso en el reverso del pase, que
  `construirReverso` relee en CADA regeneración.
- El cron diario ya existe, con su `CRON_SECRET` y su patrón de no-op.
- `hoyEnZona(comercio.zona_horaria)` y `sigueVigente` son las dos funciones con las que todo el
  sistema decide vencimientos, comparando **texto** y no instantes.

## Decisiones (las tres primeras las tomó el usuario)

1. **El mensaje lo escribe el dueño; la FECHA la pone la app.** Escribir la fecha a mano sería
   escribir una fecha fija para clientes que vencen en días distintos: el error estaría garantizado
   y sería invisible hasta que un cliente se queje. El mensaje guardado se concatena con la fecha
   real de ESA tarjeta al enviarlo. Si el dueño deja el mensaje vacío, se usa un texto por defecto
   **por tipo** (tabla, no `if`), como ya hacen `CTA_POR_TIPO` y `textosPorTipo`.

2. **Aplica a membresía y a cupón**, los dos tipos con `usaVigencia`. Al socio para que renueve, al
   del cupón para que lo use antes de que se le venza. Un cupón **ya usado** nunca recibe aviso
   (no tiene nada que aprovechar), igual que en el aviso de inactividad.

3. **La configuración es POR PROGRAMA**, no por comercio. "Renová tu membresía" y "usá tu cupón
   antes de que venza" son mensajes distintos, y un comercio puede tener los dos programas activos
   a la vez. Es además donde ya vive el plazo (`membresia_dias`, `cupon_vigencia_dias`), así que el
   dueño configura el vencimiento y su aviso en la misma pantalla.

4. **La idempotencia se resuelve con la FECHA AVISADA, no con un booleano ni un timestamp.**
   `tarjetas.aviso_vencimiento_para date` guarda *para qué vencimiento* ya se avisó. El cron manda
   solo si `aviso_vencimiento_para` es distinto de `vigencia_hasta`.
   - No se manda dos veces por el mismo vencimiento aunque el cron corra todos los días de la
     ventana.
   - **Al renovar, `vigencia_hasta` cambia y el aviso del período siguiente sale solo**, sin
     ningún paso de "resetear la marca" que alguien pueda olvidarse de llamar. Un booleano
     `aviso_enviado` habría necesitado ese reset en `renovar_membresia_atomico`, o sea acoplar el
     RPC de renovación a una feature de notificaciones — exactamente el tipo de acoplamiento que ya
     mordió a este proyecto cuando `sello_meta` se leía de una tabla y se escribía en otra.

5. **La ventana es "faltan N días o menos, y todavía no venció".** No es "faltan exactamente N":
   si el cron falla un día (o el pase se emite dentro de la ventana), un aviso de igualdad estricta
   se pierde para siempre y nadie se entera. Con "N o menos" el aviso sale al día siguiente.
   El borde inferior es `sigueVigente(vigencia_hasta, hoyDelComercio)`: el día del vencimiento
   todavía cuenta, y una vez vencida **ya no es este aviso el que corresponde** sino el de
   inactividad, que para membresía sí alcanza al vencido (decisión de la entrega anterior).

6. **Un cron nuevo NO se agrega: el existente pasa a llamarse por lo que hace.**
   `/api/cron/inactividad` se renombra a `/api/cron/avisos` y corre los DOS pases. Motivo: los dos
   son el mismo trabajo diario —avisos automáticos por push al cliente— y agregar una tercera
   entrada en `vercel.json` mete una dependencia del plan de Vercel que este trabajo no necesita
   asumir. El nombre nuevo describe lo que la ruta hace; dejarla llamándose `inactividad` mientras
   manda avisos de vencimiento sería la trampa de nombre que este proyecto viene cerrando.
   **Consecuencia a anunciar:** el `curl` de QA documentado cambia de path.

7. **Mientras el aviso de vencimiento siga VIGENTE, el de inactividad no manda.** No alcanza con
   "no los dos el mismo día", que era la primera redacción de este spec y no resuelve nada: hay UN
   solo par `aviso_texto`/`aviso_hasta` por tarjeta y `enviarMensajeTarjeta` lo sobrescribe
   incondicionalmente. Con la regla del mismo día, una membresía inactiva y por vencer recibe el
   aviso con fecha el día 1 y **al día siguiente** el de inactividad lo pisa: dos push seguidos y el
   reverso pierde la fecha.

   La regla es: `procesarAvisosInactividad` saltea la tarjeta cuyo `aviso_hasta` sea **hoy o
   futuro**. Es la condición correcta porque:
   - se apaga sola cuando el aviso caduca (`DURACION_AVISO_…_DIAS`), sin marca que limpiar;
   - **no** silencia para siempre al socio con la membresía vencida, que es lo que haría saltear por
     `aviso_vencimiento_para` (esa marca no se limpia hasta la renovación siguiente). Ese destinatario
     está blindado a propósito con un comentario largo desde la entrega anterior, y hay una prueba
     que existe para atrapar justamente esta clase de refactorización;
   - vale igual para el aviso de una campaña manual, que escribe las mismas dos columnas.

   El orden dentro del cron (vencimiento primero) deja de ser una regla de negocio y pasa a ser lo
   que hace que la condición se evalúe con el dato del día. Prueba obligatoria: una membresía
   inactiva Y por vencer recibe UN solo aviso, el de vencimiento, y el de inactividad no sale
   mientras ese siga vigente.

8. **Los días de anticipación no pueden alcanzar al plazo del propio programa.** Con
   `membresia_dias = 30` y `aviso_vencimiento_dias = 30`, `renovar_membresia_atomico` deja
   `vigencia_hasta = hoy + 30`, así que al día siguiente de PAGAR el socio recibe "tu membresía está
   por vencer". Es el reverso exacto del caso que motivó esta feature. La validación exige
   `aviso_vencimiento_dias < plazo del programa` (`membresia_dias` o `cupon_vigencia_dias` según el
   tipo), con un mensaje que lo explique. No alcanza con un CHECK de base: el cruce es entre dos
   columnas de la misma fila y depende del tipo, así que vive en `validar()` como el resto de la
   validación real de este proyecto.

## Modelo de datos — migración 0034

```sql
begin;

-- Configuración del aviso, por PROGRAMA (decisión 3). Espeja la del aviso de inactividad, que vive
-- en `comercios` (0026), pero acá va en el programa porque el mensaje depende del TIPO y porque es
-- donde ya vive el plazo que se está por vencer.
alter table programas_tarjeta
  add column aviso_vencimiento_activo boolean not null default false,
  add column aviso_vencimiento_dias integer
    check (aviso_vencimiento_dias is null or (aviso_vencimiento_dias > 0 and aviso_vencimiento_dias <= 90)),
  add column aviso_vencimiento_mensaje text
    check (aviso_vencimiento_mensaje is null or char_length(aviso_vencimiento_mensaje) <= 200);

-- PARA QUÉ vencimiento ya se avisó (decisión 4). Es una FECHA y no un booleano a propósito: al
-- renovar, vigencia_hasta cambia y el aviso del período siguiente sale solo, sin que
-- renovar_membresia_atomico tenga que acordarse de resetear nada.
alter table tarjetas
  add column aviso_vencimiento_para date;

-- El origen nuevo en la auditoría. Sin esto el insert de notificaciones_enviadas falla con 23514 y
-- el push se manda igual: quedaría un envío sin rastro, que es lo contrario de para qué existe la
-- tabla.
-- `if exists` por el precedente de la 0019, que hizo este mismo movimiento sobre
-- transacciones_puntos_tipo_check. El nombre autogenerado por Postgres para un CHECK de columna es
-- <tabla>_<columna>_check, y se verificó que no hay otro CHECK sobre `origen` que fuerce sufijo.
alter table notificaciones_enviadas
  drop constraint if exists notificaciones_enviadas_origen_check;
alter table notificaciones_enviadas
  add constraint notificaciones_enviadas_origen_check
    check (origen in ('campana', 'inactividad', 'vencimiento'));

commit;
```

**`enviarMensajeTarjeta` también cambia**, y no solo la base: su parámetro es
`origen: 'campana' | 'inactividad'`, una unión literal de TypeScript. Sin ampliarla a
`| 'vencimiento'` esto no compila — es error de compilación, no bug silencioso, pero pertenece a
esta tarea.

`scripts/verificar-0034.ts`: las columnas existen con sus defaults, el CHECK de días rechaza 91, y
—lo que de verdad importa— `notificaciones_enviadas` **acepta** un insert con `origen =
'vencimiento'`. Ojo: `tarjeta_id` es NOT NULL con FK, así que el script necesita el id de una
tarjeta REAL (lee una existente; no crea nada) y borra la fila de prueba al terminar.

## El módulo: `lib/comercio/avisoVencimiento.ts`

Hermano de `avisoInactividad.ts`, con la misma forma: constantes de cordura, `validar`,
`configuracionDesdeFormulario`, `leerConfiguracion…`, `guardarConfiguracion…` y
`procesarAvisosVencimiento`.

**La parte pura y testeable, separada del recorrido de la base:**

```ts
export const MAXIMO_DIAS_AVISO_VENCIMIENTO = 90;
export const DURACION_AVISO_VENCIMIENTO_DIAS = 14; // cuánto queda el aviso en el reverso

// ¿Le toca aviso a esta tarjeta hoy? Pura: recibe la fecha, no llama a new Date().
export function correspondeAvisar(t: {
  vigenciaHasta: string | null;
  usadoEn: string | null;
  avisoVencimientoPara: string | null;
}, diasAntes: number, hoyIso: string): boolean;

// El texto final: lo que escribió el dueño (o el default del tipo) MÁS la fecha real de esa
// tarjeta. La fecha la pone la app, nunca el dueño (decisión 1).
export function textoAviso(mensaje: string | null, tipoTarjeta: string, vigenciaHasta: string): string;
```

`correspondeAvisar` devuelve false si: no hay `vigenciaHasta` (una membresía sin activar no vence),
el cupón ya se usó, ya se avisó para esa misma fecha, la fecha ya pasó, o todavía faltan más de
`diasAntes` días. Cada uno de esos cinco casos es una prueba con su mutación.

`textoAviso` compone el mensaje del dueño seguido de "Vence el 12 de octubre de 2026.".
**Ojo: hoy el formateador de fecha NO está en un solo lugar** — hay dos copias privadas, una en
`lib/tarjetas/tipos.ts` (la que usa `describirSaldo`) y otra en `lib/tarjetas/vigencia.ts`, y
ninguna se exporta. Escribir una tercera sería el mismo error por tercera vez: la tarea EXPORTA una
y hace que las otras la usen.

**`validar` NO se puede copiar tal cual del aviso de inactividad.** Aquel exige mensaje no vacío y
su cron filtra las filas con mensaje nulo; acá el mensaje es OPCIONAL (decisión 1: vacío = el
default del tipo), así que ni la validación lo exige ni la consulta puede filtrarlo. Lo que sí se
exige con el interruptor encendido son los días, y el cruce contra el plazo del programa
(decisión 8).

**Defaults por tipo** (tabla, cubierta por una prueba que recorre los tipos con `usaVigencia`):
- membresía: *"Tu membresía está por vencer. Renovala en el local."*
- cupón: *"Tu cupón está por vencer. Aprovechalo antes de que se te pase."*

## La interfaz

En **Programas de tarjeta**, dentro de la configuración del programa (donde ya se eligen los días
de vigencia), un bloque "Aviso antes del vencimiento": interruptor, días de anticipación y el
mensaje, con el texto de ayuda diciendo que la fecha la agrega la app. Solo se dibuja en los tipos
con `usaVigencia`; en los demás, ni el bloque ni los campos.

**Ese formulario es UNO SOLO con un único `action`**, y `guardarConfiguracionPrograma` escribe sus
columnas incondicionalmente. Con dos escritores separados, o el aviso no se guarda o el bloque es
solo visual. Entonces: las tres columnas nuevas entran a `guardarConfiguracionPrograma` y a su
conversión desde el formulario, y `avisoVencimiento.ts` aporta la VALIDACIÓN y la lectura, no una
segunda escritura. Y la `key` de remonte del formulario tiene que incluir los campos nuevos, o
después de guardar vuelven a mostrarse los valores viejos (el bug de React 19 con Server Actions
que ya está documentado en el editor de marca).

## Los otros dos pendientes

### A. `pedir_monto_compra` es una perilla muerta en cupón y membresía

`usar_cupon_atomico` y `renovar_membresia_atomico` no reciben el monto: el campo aparece y el dato
se **descarta**.

**Hace falta un campo NUEVO en `TIPOS`, `usaMontoDeCompra`.** Ninguno de los cinco existentes
sirve: `requiereMonto` es "lo EXIGE" (deja afuera a puntos y sellos, que lo usan opcionalmente para
las reglas por monto), y `aplicanControlesAcreditacion` incluye a `descuento`, que sí usa el monto.
Usar `usaVigencia` porque hoy da exactamente cupón y membresía sería fusionar por coincidencia
semántica: el mismo movimiento que el propio `tipos.ts` prohíbe por escrito al explicar por qué
`aplicanControlesAcreditacion` no se fusiona con `puedeCanjearRecompensas`. Con un campo propio, un
noveno tipo no compila hasta que alguien decida su valor.

**Se arreglan las DOS superficies, y son distintas:**
- **Reglas** (la perilla del dueño) mira el programa **principal**, como el resto de esa pantalla.
- **El escáner** es por TARJETA: hoy lee `comercios.pedir_monto_compra` sin mirar el tipo de la
  tarjeta escaneada, así que un comercio con principal de puntos y un programa de cupón seguiría
  pidiendo el monto sobre el cupón. Ahí la condición usa el tipo de ESA tarjeta.

**Y la casilla oculta no se puede omitir.** `accionGuardarControles` lee la casilla del `FormData`:
si el campo no se dibuja, no llega nada y se guarda `false`. Es exactamente la mordida que ya está
resuelta tres líneas más arriba en ese mismo formulario, con un input oculto y su comentario. El
aviso explicativo reemplaza al campo VISIBLE; el oculto con el valor guardado va igual.

### B. `reporte_fm_comercios.saldo_circulante` mezcla unidades

Suma `puntos_actuales` de **todos** los comercios y **todos** los tipos: sellos con centavos con
visitas. Es el mismo defecto que la métrica del panel, a escala de plataforma, en el panel de FM.

**No se arregla sumando distinto: se deja de sumar.** No existe un "saldo total de la plataforma"
que signifique algo cuando se agregan comercios de tipos distintos. En su lugar, el panel de FM ya
muestra clientes, operaciones y canjes, que sí son comparables entre comercios. Si FM necesita el
saldo de UN comercio, ese número ya existe bien calculado en el panel del dueño (`resumenPrograma`).

Alternativa descartada: dejarlo y rotularlo "referencial". Un número que nadie puede interpretar no
mejora con una etiqueta que avise que no se puede interpretar.

**B NECESITA SU PROPIA MIGRACIÓN, LA 0035, Y VA AL REVÉS QUE LAS DEMÁS.** `saldo_circulante` no es
una columna de tabla: es una columna del `returns table` de `reporte_fm_comercios()`. Sacarla
cambia el tipo de retorno, o sea `drop function` mas `create function` mas repetir los `revoke` **y**
los `grant`: la lección que dejó escrita la 0033.

Y como es **sustractivo**, el orden es el opuesto al habitual: **primero el deploy, después la
migración.** Aplicar la 0035 antes rompe el panel de FM, igual que pasó el 2026-09-09 con el
renombre de `acreditaciones`. Los cuatro consumidores a limpiar ANTES:
`app/admin/(protegido)/reportes/page.tsx` (el `reduce` de la métrica de cabecera, la tarjeta
"Saldo circulante" entera, y el `EstadisticaMini` por comercio), `lib/reportes/reportes.test.ts` y
`lib/supabase/types.ts`.

## Fuera de alcance

- Elegir la HORA del aviso. Corre con el cron diario existente, a las 9.
- Reintentos si el push no llega. `enviarMensajeTarjeta` ya distingue "no había dispositivo" de
  "se envió", y esa auditoría alcanza.
- Un segundo aviso (por ejemplo a 7 días y a 1 día). Una sola ventana por programa; si hace falta,
  es otra columna y otra decisión.
- La QA en teléfono real, que solo puede hacer el usuario.

## Orden de trabajo

1. Migración **0034** mas `types.ts` mas `verificar-0034.ts`. **El usuario la aplica ANTES del
   deploy**: es aditiva (el CHECK de `origen` se amplía, nunca se restringe), así que la base con la
   0034 puesta sigue funcionando con el código viejo.
2. Exportar el formateador de fecha y unificar las dos copias.
3. El módulo puro `avisoVencimiento.ts` con sus pruebas de mutación.
4. El recorrido, la regla contra el aviso de inactividad (decisión 7), y el renombre del cron.
5. La interfaz en Programas.
6. Pendiente A (`usaMontoDeCompra`, las dos superficies, y el input oculto).
7. Pendiente B, en DOS pasos y en este orden: **(7a)** limpiar los cuatro consumidores de
   `saldo_circulante` y desplegar; **(7b)** recién entonces el usuario aplica la **0035** que la
   retira de la función. Es sustractivo: al revés que todo lo demás.
8. Verificación, estado, deploy.
