// Sellos de regalo al registrarse: cuántos sellos trae ya puestos la tarjeta de un cliente nuevo
// (columna programas_tarjeta.sellos_regalo, migración 0043). Es el efecto de progreso empezado
// (Nunes y Drèze, 2006): el cliente cuya tarjeta ya arranca con un par de sellos puestos siente que
// ya avanzó, y tiende a completarla más que una tarjeta en blanco.
// Plan: docs/superpowers/plans/2026-10-28-sellos-de-regalo.md, sección 3.2.
//
// Módulo PURO a propósito: sin Supabase ni nada que arrastre el servidor. Lo importan el guardado de
// Marca (Server Action), el formulario de Marca (componente de cliente, para el texto en vivo) y la
// página de registro; los tres tienen que leer la MISMA regla y los mismos textos.
//
// La regla es la hermana de cara al dueño del CHECK de la base (programas_tarjeta_sellos_regalo_check:
// `sellos_regalo = 0 or (sello_meta is not null and sellos_regalo < sello_meta)`). El CHECK es la
// red de seguridad que ningún camino puede saltear; esta función es la que le explica al dueño QUÉ
// puso mal, en vez de dejarlo frente a un "violates check constraint".

// Devuelve el mensaje para el dueño, o null si el valor es válido. Las reglas van EN ESTE ORDEN y el
// orden importa:
//
// 1. Un valor que no es entero (NaN, 1.5, Infinity) o es negativo se rechaza primero, con
//    independencia de la meta: si no, `-1` con meta 10 pasaría como "menos que la meta" y un NaN
//    pasaría todas las comparaciones (cualquier comparación con NaN es false).
// 2. 0 es el valor por defecto y significa "sin regalo": es válido con cualquier meta, incluida
//    ninguna. Va antes de la regla 3 porque un programa que no es de sellos tiene meta null y regalo
//    0, y NO puede pedirle nada a ese dueño.
// 3. Regalar sin meta no tiene sentido ("menos que la meta" no se puede calcular). Se le pide la
//    meta primero, en vez de dejarlo chocar con la regla 4 por una meta que ni existe.
// 4. El regalo tiene que ser MENOR que la meta, no menor o igual: con regalo igual a la meta, la
//    tarjeta nacería completa y el primer cliente canjearía sin haber comprado nada.
export function validarSellosRegalo(selloMeta: number | null, sellosRegalo: number): string | null {
  if (!Number.isInteger(sellosRegalo) || sellosRegalo < 0) {
    return 'Los sellos de regalo tienen que ser un número entero, 0 o más.';
  }

  if (sellosRegalo === 0) return null;

  if (selloMeta === null) {
    return 'Poné la meta de sellos antes de regalar sellos.';
  }

  if (sellosRegalo >= selloMeta) {
    return `Los sellos de regalo tienen que ser menos que la meta (${selloMeta}): si no, la tarjeta nacería completa.`;
  }

  return null;
}

// Lee el campo `sellos_regalo` del formulario de Marca. Devuelve un número que NO está validado
// todavía: quien llama lo pasa por validarSellosRegalo, que es la que rechaza NaN, decimales y
// negativos.
//
// AUSENTE ES 0, A PROPÓSITO. El campo solo se dibuja cuando el programa es de sellos (igual que la
// meta, que en los demás tipos se manda vacía y queda en null). Si "ausente" significara "no tocar",
// un programa al que el FM le cambió el tipo quedaría con meta null y regalo 2, y el CHECK de la
// base tumbaría TODO el guardado de Marca de ese dueño, colores y textos incluidos.
//
// No hace falta ni `trim()` ni un caso aparte para el vacío: `Number('')` y `Number('  ')` dan 0 (y
// `Number(' 2 ')` da 2), que es justo lo que se quiere: un campo en blanco es "sin regalo". Lo que sí
// importa es NO usar parseInt/parseFloat, que leen '2a' como 2 y guardarían un regalo que el dueño no
// escribió; `Number('2a')` da NaN y la regla 1 lo frena. Un File (un formulario armado a mano puede
// mandar un archivo bajo ese nombre) también da NaN, y por eso NO se trata como ausente: borraría el
// regalo del dueño en silencio.
export function sellosRegaloDesdeFormulario(valor: FormDataEntryValue | null): number {
  if (valor === null) return 0;
  return Number(valor);
}

// El texto de debajo del campo en Marca, en vivo. Solo se muestra con regalo mayor que 0 y meta
// válida (el componente decide cuándo); con eso, `meta - regalo` es siempre 1 o más.
//
// "le falta 1" en singular, "le faltan N" desde 2: con el regalo más grande que admite la regla (9 de
// 10) el dueño leía "le faltan 1", que se lee como un error de la pantalla. Misma regla que
// textoRegaloRegistro: singular SOLO con exactamente uno.
//
// Dice "es un regalo de verdad" sin rodeos: en el estudio las dos tarjetas pedían el mismo esfuerzo,
// pero en Cardly la meta es del PROGRAMA y no de cada tarjeta, así que subir la meta para
// compensarlo cambiaría la meta de todos los clientes que ya tienen tarjeta. El dueño tiene que
// saber que está regalando algo. Y "las tarjetas que ya existen no cambian" lo tranquiliza sobre
// sus clientes de hoy: el regalo se da UNA vez, al nacer la tarjeta.
export function describirArranque(selloMeta: number, sellosRegalo: number): string {
  const faltan = selloMeta - sellosRegalo;
  const verbo = faltan === 1 ? 'le falta' : 'le faltan';
  return `Un cliente nuevo arranca con ${sellosRegalo} de ${selloMeta} sellos: ${verbo} ${faltan}. Es un regalo de verdad, y las tarjetas que ya existen no cambian.`;
}

// La línea de la página de registro, para el cliente. Solo con regalo mayor que 0. El efecto
// depende de que el cliente lo NOTE, y la página de registro es su primer contacto con la tarjeta.
// Singular SOLO con exactamente uno (misma regla que unidadPara en unidadPrograma.ts).
export function textoRegaloRegistro(sellosRegalo: number): string {
  const palabra = sellosRegalo === 1 ? 'sello' : 'sellos';
  return `Arrancás con ${sellosRegalo} ${palabra} de regalo.`;
}

// La línea del FORMULARIO de registro, la que se lee ANTES de registrarse. Solo con regalo mayor que 0.
//
// POR QUÉ NO ES textoRegaloRegistro: antes de enviar, la página no puede saber si ese teléfono ya tiene
// tarjeta (eso lo resuelve el servidor al registrar), y el regalo se da UNA sola vez, a las tarjetas
// NUEVAS. La frase sin condición se le mostraba a todos, y un cliente que volvía (el propio dueño, con
// 5 sellos) leía "Arrancás con 2 sellos de regalo.", se registraba y recibía su tarjeta de siempre, sin
// regalo: la pantalla le había prometido algo falso. Con "Si es tu primera tarjeta," la promesa es
// verdad para todos los que la leen.
//
// "Tu tarjeta está lista" SIGUE con textoRegaloRegistro: ahí la línea solo sale cuando la API dice que
// la tarjeta de verdad recibió el regalo (`sellosRegalo` de la respuesta es mayor que 0), así que la
// frase sin condición ya es cierta y ponerle "Si es tu primera tarjeta" sería hablarle de un "si" que
// ya se resolvió.
//
// Singular SOLO con exactamente uno, misma regla que textoRegaloRegistro.
export function textoRegaloAntesDeRegistrar(sellosRegalo: number): string {
  const palabra = sellosRegalo === 1 ? 'sello' : 'sellos';
  return `Si es tu primera tarjeta, arrancás con ${sellosRegalo} ${palabra} de regalo.`;
}

// El aviso de Marca cuando el regalo, por sí solo, ya alcanza una recompensa. NO bloquea el guardado
// (decisión del dueño del proyecto: es una advertencia, no una regla).
//
// POR QUÉ EXISTE: el canje (canjear_recompensa_atomico, migración 0009) solo exige
// `puntos_actuales >= costo_puntos` de CUALQUIER recompensa activa del comercio. Con recompensas
// escalonadas (un café a 5 sellos y un almuerzo a 10), un regalo de 5 con meta 10 pasa la regla de
// arriba (5 < 10) pero iguala el costo del café: el cliente nuevo se registra y canjea ese mismo
// día, sin comprar nada y sin pasar por el antifraude (el regalo no es una acreditación). La meta no
// protege de esto porque el canje no mira la meta: mira el costo de la recompensa.
//
// Recibe la recompensa activa MÁS BARATA del comercio (no del programa: el canje no distingue
// programa) porque si el regalo no alcanza a esa, no alcanza a ninguna.
//
// Devuelve null si no hay nada que avisar: regalo 0 o menos (no hay regalo), un regalo que no es un
// entero (no es uno que el servidor aceptaría; evita escribir "Con NaN de regalo"), sin recompensa, o
// un regalo MENOR que su costo. Con el regalo IGUAL al costo SÍ avisa: el canje exige `>=`, así que
// un cliente nuevo con exactamente el costo ya puede canjear.
export function avisoRegaloAlcanzaPremio(
  sellosRegalo: number,
  recompensaMasBarata: { nombre: string; costoPuntos: number } | null,
): string | null {
  if (!Number.isInteger(sellosRegalo) || sellosRegalo <= 0) return null;
  if (recompensaMasBarata === null) return null;
  if (sellosRegalo < recompensaMasBarata.costoPuntos) return null;

  return `Con ${sellosRegalo} de regalo, un cliente nuevo ya puede canjear «${recompensaMasBarata.nombre}» sin haber comprado nada.`;
}

// Cuántos sellos de regalo PROMETE la página de registro de un programa. Solo un programa de tipo
// EXACTAMENTE 'sellos' regala (la misma regla que emitir_tarjeta en la base, que lee el regalo solo si
// `tipo_tarjeta = 'sellos'`): en cualquier otro tipo la columna puede traer un número viejo (el FM le
// cambió el tipo a un programa que regalaba 2) y la pantalla no puede prometer un regalo que la tarjeta
// nueva no va a traer. Vivía como un ternario copiado en las dos páginas de registro (la del QR sin
// programa y la del QR de un programa) sin ninguna prueba; si una se corregía y la otra no, un QR
// prometía lo que el otro no.
export function sellosRegaloDelPrograma(tipoTarjeta: string, sellosRegalo: number): number {
  return tipoTarjeta === 'sellos' ? sellosRegalo : 0;
}

// Lee de la respuesta JSON de /api/registro un número de la tarjeta (`sellosRegalo`, `puntosActuales`)
// para dibujar la tarjeta de muestra de "Tu tarjeta está lista". Solo un ENTERO de 0 en adelante
// cuenta; todo lo demás (el campo ausente de una versión vieja de la API, null, un texto, un decimal,
// un negativo, NaN, Infinity) es 0, que es lo que la muestra dibujaba antes de que existieran. Un
// contador de sellos que no es entero nunca es un saldo real, y dibujarlo sería inventar un número.
export function contadorDeRespuesta(valor: unknown): number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 ? valor : 0;
}
