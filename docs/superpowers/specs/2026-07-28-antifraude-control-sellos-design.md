# Antifraude y control de sellos — diseño (Tanda 1)

Fecha: 2026-07-28. Migración: `0015_antifraude_control_sellos.sql`.

## Por qué

El MVP está completo y en producción. El primer feedback real de los comercios es una sospecha
concreta: **un cajero puede estar regalando sellos.** El sistema no permite ni detectarlo ni
corregirlo.

- `transacciones_puntos` y `canjes` guardan todo lo necesario desde la 0001 (tarjeta, cajero,
  sucursal, hora), pero **no hay ninguna pantalla que muestre los movimientos de UN cliente**. Los
  reportes solo agregan.
- **No hay forma de quitar sellos.** La única resta es `canjear_recompensa_atomico`, atada a una
  recompensa concreta con su costo fijo. Un cajero que puso 5 en vez de 1 no tiene arreglo.
- **No hay ningún límite.** `reglas_puntos` ni siquiera alimenta el escáner: el delta lo escribe el
  cajero a mano y nada lo acota.

## Contexto competitivo

Comparación con Vuelvo Cards (`vuelvocards.com`), el competidor directo en El Salvador, hecha el
2026-07-28. Se guarda acá porque orienta las tandas siguientes.

| Capacidad | Vuelvo | Cardly hoy |
|---|---|---|
| Apple + Google Wallet | Sí | Sí |
| Tipos de tarjeta | 8 vivos | 8 en catálogo, **2 vivos** (puntos, sellos) |
| Push con mensaje propio | Sí | Solo push silencioso de refresco |
| Geopush por cercanía | Sí (dice "50–500 m") | No |
| Historial de visitas por cliente | Sí | Datos sí, pantalla no |
| Segmentación RFM / referidos / cumpleaños | Sí | No |
| Exportar base de clientes | Sí | No |
| API + webhooks | Sí (Elite) | No |
| Autogestión de plan/pago | Sí | Licencia manual de FM |
| Teléfono internacional | Sí | **+503 hardcodeado** |
| Analítica / BI | Comparable | Comparable |
| Multi-marca por cuenta | No lo ofrecen | **Sí** |
| Portal del cliente | No lo mencionan | **Sí** (`/mi-tarjeta`) |
| Reverso configurable del pass | No lo mencionan | **Sí** |
| Personalización visual | Logo + colores | **Más completa** |
| **Antifraude / límite por día** | No lo mencionan | No |
| **Corregir/quitar sellos** | No lo mencionan | No |
| **Auditoría por cajero** | No lo mencionan | No |
| Precios | $25/$50/$100 anual + setup | $29/$49/$89 + setup $149 |

Las tres últimas filas son la razón de que esta sea la Tanda 1: **es lo único que ningún competidor
vende.** No es ponerse a la par, es reclamar una categoría.

### Verificaciones técnicas que corrigen supuestos del brief

- **Geopush en iOS sí lleva mensaje propio.** `locations[].relevantText` (128 caracteres) es texto
  del comercio y editable. Lo que no lleva es sonido: es una tarjeta sugerida en la pantalla de
  bloqueo, radio ~100 m, máximo 10 ubicaciones por pase.
- **Geopush en Android es al revés:** notificación real con sonido, radio ~150 m, pero **el texto lo
  pone Google y no se puede editar**, y hay un tope de 4 notificaciones por usuario por día.
- Ninguna plataforma llega a los 500 m que anuncia Vuelvo: usan estos mismos dos mecanismos.
- **Stripe no acepta negocios de El Salvador** (no está entre los 46 países soportados). La
  personería jurídica salvadoreña no lo habilita; haría falta una entidad en EE.UU. o UK.
- `recompensas.foto_url` y `transacciones_puntos.monto_compra` **existen desde la 0001 y nunca se
  cablearon.** No son columnas nuevas: son columnas muertas a reconectar.

## Decisiones

1. **Cuatro perillas de control**, todas opcionales y por comercio (`null` = sin límite): tope de
   acreditaciones/día, espera mínima entre acreditaciones, techo de puntos por transacción, tope de
   puntos/día. Las dos últimas solo se muestran si `tipo_tarjeta = 'puntos'`.

   *Por qué no solo un tope diario:* un tope de 2/día no impide que el cajero ponga los 2 seguidos
   en diez segundos. La espera mínima es la que ataja la corrupción; el tope diario ataja el caso
   del cliente que compra en la mañana y en la tarde.

2. **Al alcanzar un límite el cajero queda bloqueado; solo el dueño puede forzar**, escribiendo un
   motivo que queda grabado y marcado como forzada.

3. **El cajero puede quitar/corregir**, con motivo obligatorio y auditado con su nombre.

4. **Solo se puede RESTAR desde el ajuste.** El RPC acepta cualquier signo (la política vive en TS),
   pero `quitarPuntos` rechaza sumar. Si el ajuste pudiera sumar, un cajero bloqueado por el tope
   tendría una puerta trasera —"ajuste +5" con cualquier motivo— y todo el sistema de límites
   quedaría en nada. La corrección hacia arriba pasa por el camino forzado, que es del dueño y deja
   la fila marcada.

5. **El cliente ve su propio historial** en `/mi-tarjeta`, con proyección reducida: sin nombre de
   cajero y sin motivo interno. Es el mejor detector de sellos fantasma que existe.

6. **`monto_compra` se activa**, opcional por comercio.

## Esquema

Todo aditivo, sin backfill. En `transacciones_puntos`: `tipo` (`'acreditacion'|'ajuste'`, default
`'acreditacion'`), `motivo`, `forzado`, más un CHECK que exige motivo cuando `tipo='ajuste'` o
`forzado`. En `comercios`: las 4 perillas, `pedir_monto_compra` y `zona_horaria` (CHECK de lista
cerrada, espejo de `lib/comercio/zonasHorarias.ts`).

**La zona horaria lleva lista cerrada por una razón dura:** un nombre inválido hace que
`at time zone` lance `22023` **dentro** del RPC de acreditar, o sea que un typo en un campo de
configuración dejaría al comercio sin poder sellar.

## Concurrencia — la decisión central

**Un `count(*)` antes del `update` no es confiable, y no puede serlo.** En READ COMMITTED cada
sentencia toma su propio snapshot, un `count(*)` no toma ningún lock, y no existe predicate locking
(eso es SERIALIZABLE). Dos escaneos simultáneos con tope 5 y 4 filas leerían los dos "4 de 5",
pasarían los dos, y quedarían 6.

**Tampoco sirve meter el `count` en el `WHERE` del `UPDATE`**: la re-evaluación EPQ sustituye
únicamente la fila bloqueada, y el resto del qual se sigue evaluando contra el snapshot original.
Ese truco funciona para canjear/ajustar (`puntos_actuales >= costo` es sobre la propia fila) y no acá.

**Solución:** `select ... from tarjetas where id = ... and comercio_id = ... for no key update` antes
de los chequeos. El segundo escaneo bloquea ahí; cuando el primero commitea, el segundo sigue y su
siguiente sentencia toma snapshot nuevo, que ya lo incluye. El `WHERE` del lock solo referencia
columnas inmutables (`id`, `comercio_id`) — con una columna mutable la fila desaparecería en
silencio bajo concurrencia. `for no key update` y no `for update` porque es exactamente la fuerza
que ya toma un `UPDATE` de una columna no-clave: el footprint de bloqueo queda idéntico al de hoy.

**La regla general:** el lock explícito hace falta exactamente cuando la decisión depende de datos
que el `WHERE` del `UPDATE` no puede expresar sobre la propia fila bloqueada.

**Invariante a sostener a mano:** el conteo solo es confiable porque todos los escritores de
`transacciones_puntos` pasan por ese lock. Cualquier camino futuro que inserte en esa tabla (un
import, un script de corrección, una API) tiene que tomarlo primero.

## Por qué `acreditar_puntos_atomico` sobrevive como wrapper

`CREATE OR REPLACE FUNCTION` no puede cambiar la lista de argumentos: agregarle `p_monto_compra`
crearía una función nueva que convive con la vieja y vuelve **ambigua (42725)** toda llamada con 5
argumentos nombrados. Dejándola con su firma exacta y delegando en `acreditar_atomico`, la migración
se puede aplicar antes del deploy sin romper nada: el código viejo llama 5 args y se comporta bit a
bit igual (las perillas nacen en `null`). Se borra en una migración posterior — expand → migrate →
contract.

El chequeo de sucursal va **primero** dentro de `acreditar_atomico` por la misma razón: preserva el
comportamiento exacto de la 0009 en el caso borde "comercio inexistente Y sucursal inválida".

## Consecuencia aceptada

A partir de la 0015, `puntos_otorgados` en los reportes es **bruto, no neto**: si un cajero da 10 y
alguien quita 10, el reporte de sucursal sigue diciendo 10 otorgados. Es lo correcto — así el fraude
no se autoborra del reporte. La corrección aparece en `reporte_cajeros`, y el neto real ya está en
`reporte_fm_comercios.saldo_circulante`.

## Control de la migración

Las cuatro funciones de reporte se reescriben a mano para agregarles `where tipo = 'acreditacion'`.
El riesgo no es funcional (el default clasifica el 100% del histórico) sino **tipográfico**. El
control es `scripts/snapshot-reportes.ts`: se corre antes y después de aplicar la migración y el
diff tiene que ser **vacío**.

## Fuera de alcance

Geopush y campañas (Tanda 3), selector de país e imagen por premio (Tanda 2), autogestión de plan y
tipos de tarjeta nuevos (Tanda 4). Stripe y N1co, sin fecha.
