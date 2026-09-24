import type { BilleteraDeEntrada } from '../clientes/plataforma';
import { tipoOPuntos, TIPOS } from './tipos';

// Los textos de interfaz que CAMBIAN según el tipo de tarjeta, en una tabla por concepto.
//
// ══ POR QUÉ EXISTE ══
// Hasta el 2026-09-08 estos textos estaban cableados en la pantalla que los mostraba, y todos
// hablaban de sellos o de puntos. Como el catálogo tiene OCHO tipos, los otros seis leían una
// mecánica que su tarjeta no tiene. El caso que lo destapó: un comercio de MEMBRESÍA cuyo panel
// le decía "Sumá sellos/puntos o canjeá premios" en el atajo de escanear —— cuando lo único que
// ese comercio hace al escanear es renovar la membresía de su socio. Su cliente, además, veía en
// la pantalla de registro la promesa "empieza a sumar puntos", que en esa tarjeta es mentira.
//
// La defensa es la misma que ya usan `CTA_POR_TIPO` (el cartel) y `ETIQUETA_PRINCIPAL` (el
// escáner): un `Record` con los ocho tipos y una prueba que obliga a cubrirlos. La búsqueda es
// DIRECTA sobre la tabla, sin `?? tabla.puntos`, para que un tipo nuevo del catálogo sin texto
// propio rompa la prueba en vez de heredar "puntos" en silencio —— que es exactamente el defecto
// que este módulo vino a cerrar. El único fallback vive en `tipoOPuntos`, y actúa nada más sobre
// un valor que NO está en el catálogo (una fila vieja de la BD, un tipo escrito a mano): ahí sí
// conviene degradar antes que dejar una pantalla en blanco.
//
// Voseo salvadoreño en todo, igual que el resto de la aplicación ("Sumá", "Renová", "Pasá").

// Quién lee cada tabla está anotado en su comentario, porque el TONO depende de eso: las dos
// primeras las lee el DUEÑO (son atajos de su panel, puede hablar de "tu cliente"); las otras
// cuatro terminan frente al CLIENTE FINAL, que no sabe nada del sistema.

// ─────────────────────────────────────────────────────────────────────────────
// Panel del dueño
// ─────────────────────────────────────────────────────────────────────────────

// Subtítulo del atajo "Escanear tarjeta". Describe lo que el cajero HACE con esta tarjeta, así que
// sigue de cerca a `ETIQUETA_PRINCIPAL`/`ETIQUETA_SECUNDARIA` del escáner (escanear/actions.ts):
// si el atajo promete una operación que los botones no ofrecen, el dueño escanea para nada.
const ATAJO_ESCANEAR: Record<string, string> = {
  puntos: 'Sumá puntos o canjeá premios',
  sellos: 'Sumá sellos o canjeá premios',
  prepago: 'Descontá una visita o vendé un paquete',
  gift_card: 'Cobrá con el saldo o cargá más',
  cashback: 'Acreditá el cashback de la compra',
  cupon: 'Marcá el cupón como usado',
  membresia: 'Renová la membresía de tu socio',
  descuento: 'Registrá la compra y aplicá su descuento',
};

// Subtítulo del atajo "Reglas del programa". Cinco tipos comparten texto A PROPÓSITO, y no es
// pereza: en `reglas/page.tsx` el formulario de acumulación solo se dibuja cuando el tipo cuenta
// enteros (`unidadPrograma` distinta de null). A los otros cinco esa pantalla les muestra los
// controles antifraude y el aviso de inactividad, nada más —— prometerles reglas de puntos sería
// mandarlos a una pantalla que les dice "tu tarjeta no necesita estas reglas".
const ATAJO_REGLAS: Record<string, string> = {
  puntos: 'Cuántos puntos gana y controles de escaneo',
  sellos: 'Cuántos sellos gana y controles de escaneo',
  prepago: 'Cuántas visitas gana y controles de escaneo',
  gift_card: 'Controles de escaneo y aviso de inactividad',
  cashback: 'Controles de escaneo y aviso de inactividad',
  cupon: 'Controles de escaneo y aviso de inactividad',
  membresia: 'Controles de escaneo y aviso de inactividad',
  descuento: 'Controles de escaneo y aviso de inactividad',
};

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla de registro (la lee el CLIENTE FINAL)
// ─────────────────────────────────────────────────────────────────────────────
// Son DOS tablas y no una porque los dos textos de esa pantalla dicen cosas distintas en momentos
// distintos, y un solo texto para los dos quedaría mal en alguno:
//   - PROMESA_REGISTRO va ANTES de registrarse: es el motivo para dejar su teléfono. Habla en
//     futuro y tiene que responder "¿y yo qué gano?".
//   - COLA_TARJETA_LISTA va DESPUÉS, encima de los botones de Wallet: la tarjeta ya existe y lo
//     único que falta es guardarla. Prometer otra vez el beneficio ahí sobra; lo que hace falta es
//     decirle qué tiene ahora en el teléfono. Guarda solo la COLA por tipo: la billetera que se
//     nombra adelante la pone `promesaTarjetaLista` (ver su comentario, abajo).
// Ninguna de las dos interpola el nombre del comercio: la pantalla ya lo tiene en el título y en
// la tarjeta de muestra, y una frase con el nombre adentro se rompe con un comercio de nombre
// largo.

// OJO CON EL TRATO: estas dos tablas (y FRASE_BILLETERA, que completa la segunda) van en TUTEO
// ("Regístrate", "Agrégala", "tu teléfono"), y solo ellas. El resto del módulo vosea, igual que
// todo el panel del dueño. No es un descuido: las pantallas que ve el CLIENTE FINAL (registro y
// portal) tutean desde siempre, y el usuario lo confirmó como decisión el 2026-09-08. Mezclar los
// dos registros en la misma pantalla se nota y queda mal, así que si algún día se unifica hay que
// cambiar la pantalla entera, no una frase suelta.
const PROMESA_REGISTRO: Record<string, string> = {
  puntos: 'Regístrate una vez y suma puntos en cada visita.',
  sellos: 'Regístrate una vez y junta tus sellos en cada visita.',
  prepago: 'Regístrate una vez y lleva la cuenta de tus visitas.',
  gift_card: 'Regístrate una vez y lleva tu saldo siempre a mano.',
  cashback: 'Regístrate una vez y recupera una parte de cada compra.',
  cupon: 'Regístrate una vez y lleva tu cupón en el teléfono.',
  membresia: 'Regístrate una vez y lleva tu membresía en el teléfono.',
  descuento: 'Regístrate una vez y gana tu descuento por lo que compras.',
};

// Lo que va después de "Agrégala a <billetera> y …". Tiene que leerse bien detrás de las TRES
// billeteras de FRASE_BILLETERA ("tu Apple Wallet", "tu Google Wallet", "la billetera de tu
// teléfono"): por eso ninguna cola nombra una marca.
const COLA_TARJETA_LISTA: Record<string, string> = {
  puntos: 'empieza a sumar puntos hoy.',
  sellos: 'empieza a juntar tus sellos hoy.',
  prepago: 'mira tus visitas cuando quieras.',
  gift_card: 'mira tu saldo cuando quieras.',
  cashback: 'mira tu saldo cuando quieras.',
  cupon: 'muestra tu cupón cuando lo uses.',
  membresia: 'muéstrala cada vez que vengas.',
  descuento: 'muéstrala en cada compra.',
};

// La billetera que nombra el subtítulo, según el botón que el cliente ve DE ENTRADA
// (`billeteraDeEntrada`, lib/clientes/plataforma.ts). Con los dos botones a la vista no se elige
// una marca: "la billetera de tu teléfono", la misma frase que usa el formulario en 'otra'
// (`fraseWalletDelFormulario`). `Record` sobre el tipo de la billetera, no sobre string: una
// billetera nueva sin frase no compila.
const FRASE_BILLETERA: Record<BilleteraDeEntrada, string> = {
  apple: 'tu Apple Wallet',
  google: 'tu Google Wallet',
  ambas: 'la billetera de tu teléfono',
};

// ─────────────────────────────────────────────────────────────────────────────
// Placeholders de los mensajes que el dueño le manda a su cliente
// ─────────────────────────────────────────────────────────────────────────────
// El dueño puede reescribirlos enteros: son el ejemplo del campo vacío, no el mensaje que sale.
// Aun así importan —— un placeholder es lo que la mayoría termina copiando, y el que estaba
// cableado ("ya tenés sellos acumulados") le hacía prometer sellos a quien vende membresías.

// Aviso por inactividad: le llega a alguien que hace N días que no aparece. Habla de lo que ya
// TIENE esperándolo, que es el único motivo real para volver.
const PLACEHOLDER_INACTIVIDAD: Record<string, string> = {
  puntos: '¡Te extrañamos! Volvé y seguí sumando puntos.',
  sellos: '¡Te extrañamos! Volvé y completá tu tarjeta de sellos.',
  prepago: 'Todavía te quedan visitas sin usar. ¡Te esperamos!',
  gift_card: 'Todavía tenés saldo en tu tarjeta. ¡Te esperamos!',
  cashback: '¡Te extrañamos! Volvé y ganá cashback en tu próxima compra.',
  cupon: 'Tu cupón sigue disponible. ¡Usalo antes de que venza!',
  membresia: 'Tu membresía sigue activa. ¡Te esperamos!',
  descuento: 'Tu descuento te sigue esperando. ¡Pasá cuando querás!',
};

// Geopush: le llega al cliente cuando está PARADO cerca del local, así que es la más corta de
// todas y tiene que caber en la pantalla bloqueada de un teléfono.
const PLACEHOLDER_CERCANIA: Record<string, string> = {
  puntos: 'Estás cerca: pasá y sumá puntos',
  sellos: 'Estás cerca: pasá y sumá tu sello de hoy',
  prepago: 'Estás cerca: usá una de tus visitas',
  gift_card: 'Estás cerca: gastá el saldo de tu tarjeta',
  cashback: 'Estás cerca: comprá y ganá cashback',
  cupon: 'Estás cerca: aprovechá tu cupón',
  membresia: 'Estás cerca: pasá y usá tu membresía',
  descuento: 'Estás cerca: pasá y usá tu descuento',
};

// ─────────────────────────────────────────────────────────────────────────────
// Acceso
// ─────────────────────────────────────────────────────────────────────────────

// Búsqueda directa: si el tipo ESTÁ en el catálogo pero le falta la entrada, devuelve undefined y
// la prueba de cobertura falla. Lo que se degrada es el valor DESCONOCIDO, y lo hace tipoOPuntos.
function textoDe(tabla: Record<string, string>, tipoTarjeta: string): string {
  return tabla[tipoOPuntos(tipoTarjeta).valor];
}

export function textoAtajoEscanear(tipoTarjeta: string): string {
  return textoDe(ATAJO_ESCANEAR, tipoTarjeta);
}

export function textoAtajoReglas(tipoTarjeta: string): string {
  return textoDe(ATAJO_REGLAS, tipoTarjeta);
}

export function promesaRegistro(tipoTarjeta: string): string {
  return textoDe(PROMESA_REGISTRO, tipoTarjeta);
}

// La billetera es OBLIGATORIA y sin valor por defecto, a propósito. Hasta el 2026-09-23 esta función
// recibía solo el tipo y cada frase decía "tu Apple Wallet" cableado: un cliente de Android lo leía
// encima del único botón que veía, el de Google (Tarea 6b del plan Wallet/logos). La firma no podía
// expresar el caso, así que se le arregló la FIRMA; un default reinstalaría la trampa para el
// próximo llamador que no sepa qué botón se dibuja.
export function promesaTarjetaLista(tipoTarjeta: string, billetera: BilleteraDeEntrada): string {
  return `Agrégala a ${FRASE_BILLETERA[billetera]} y ${textoDe(COLA_TARJETA_LISTA, tipoTarjeta)}`;
}

export function placeholderInactividad(tipoTarjeta: string): string {
  return textoDe(PLACEHOLDER_INACTIVIDAD, tipoTarjeta);
}

export function placeholderCercania(tipoTarjeta: string): string {
  return textoDe(PLACEHOLDER_CERCANIA, tipoTarjeta);
}

// El rótulo superior de la tarjeta de muestra (hoy "Tarjeta de lealtad" fijo para todos). NO tiene
// tabla propia: sale de la etiqueta del catálogo, que es la misma palabra que el dueño eligió al
// crear su programa. Con una tabla aparte, un cambio de etiqueta dejaría al cliente leyendo una
// palabra distinta de la que su comercio contrató.
export function rotuloTarjeta(tipoTarjeta: string): string {
  return tipoOPuntos(tipoTarjeta).etiqueta;
}

// Espejo del catálogo, igual que en ctaSugerido: deja explícito que este módulo depende de TIPOS y
// no de una lista suelta propia.
export const TIPOS_CON_TEXTOS = TIPOS.map((t) => t.valor);
