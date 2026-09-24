// Detecta desde qué teléfono llega el cliente (para mostrarle el botón de SU billetera primero, no
// el de la otra) y decide qué botones de Wallet dibujar. Puro y con prueba — ver plataforma.test.ts.
//
// POR QUÉ EXISTE: hasta el 2026-09-23 la pantalla de éxito del registro mostraba SIEMPRE "Agregar a
// Apple Wallet" primero, y "Agregar a Google Wallet" debajo si estaba disponible. En un onboarding
// real, un cliente de Android veía primero el botón de Apple, que no le sirve (spec Wallet/logos
// §1). La detección resuelve eso: en Android se ofrece Google, y Apple queda detrás de un link
// "¿Tienes otro teléfono?" por si la detección falló.

export type Plataforma = 'ios' | 'android' | 'otra';

// Detección por user agent, del lado del SERVIDOR (headers(), no navigator.userAgent): así la
// primera pintura ya es la correcta y no hay desajuste de hidratación entre servidor y cliente.
//
// - 'ios': `iPhone`, `iPod` o `iPad` en el UA. Cubre Safari, Chrome (`CriOS`) y los navegadores
//   internos de WhatsApp/Instagram en iPhone: Chrome e Instagram SÍ agregan su propio token
//   (`CriOS/…`, `Instagram …`), pero todos corren sobre WKWebView/SFSafariViewController y
//   CONSERVAN `iPhone` en la parte del UA que describe el dispositivo.
// - 'android': `Android` en el UA (Chrome, Samsung Internet, navegadores internos de apps).
// - 'otra': todo lo demás — computadoras, user agent ausente, y el caso adrede irresoluble: un iPad
//   con iPadOS 13+ reporta `Macintosh` (Apple lo hace a propósito, para que los sitios le sirvan la
//   versión de escritorio), así que del lado del servidor es indistinguible de una Mac real. Un iPad
//   VIEJO (iOS 12 o anterior) sí dice `iPad` en su UA y cae en 'ios'.
export function detectarPlataforma(userAgent: string | null): Plataforma {
  if (!userAgent) return 'otra';
  if (/iPhone|iPod|iPad/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'otra';
}

export interface BotonesWalletEntrada {
  plataforma: Plataforma;
  // Si hay un botón de Google para ofrecer (el comercio sincronizó su clase). Sin esto, 'ios' no
  // tendría nada que revelar con el link y 'android' cae al botón de Apple como hoy.
  googleDisponible: boolean;
  // Si el cliente ya tocó "¿Tienes otro teléfono?" en ESTA pantalla (estado del componente que
  // llama). Antes de tocarlo, solo se ve el botón de la plataforma detectada.
  mostrarOtro: boolean;
}

export interface BotonesWalletResultado {
  apple: boolean;
  google: boolean;
  // Si se ofrece el link "¿Tienes otro teléfono?" — solo tiene sentido cuando hay algo más para
  // revelar y todavía no se reveló.
  link: boolean;
  // La nota "…ábrelo desde Safari" (spec: cada vez que el botón de Apple está a la vista en 'ios' u
  // 'otra'; NUNCA en 'android' — el navegador de Android no es Safari y la nota no aplica aunque el
  // cliente haya revelado el botón de Apple con el link).
  notaSafari: boolean;
}

// Regla de la spec: ios → Apple (+ link si hay Google para revelar); android → Google si está
// disponible, si no Apple SIN link (no hay nada mejor que ofrecer); otra → los dos, sin link (ya
// está todo a la vista, no hay nada que revelar). Tocar el link ("mostrarOtro") muestra los dos.
export function botonesWallet({
  plataforma,
  googleDisponible,
  mostrarOtro,
}: BotonesWalletEntrada): BotonesWalletResultado {
  if (plataforma === 'android') {
    // Apple SIEMPRE existe (no depende de ningún logo ni sincronización), pero en Android no es la
    // billetera del cliente: se esconde detrás del link salvo que Google no esté disponible (ahí
    // Apple es lo único que hay, como antes de esta detección) o el cliente ya haya tocado el link.
    const apple = googleDisponible ? mostrarOtro : true;
    return {
      apple,
      google: googleDisponible,
      link: googleDisponible && !mostrarOtro,
      notaSafari: false,
    };
  }

  if (plataforma === 'ios') {
    return {
      apple: true,
      google: googleDisponible && mostrarOtro,
      link: googleDisponible && !mostrarOtro,
      notaSafari: true,
    };
  }

  // 'otra': computadora, user agent ausente, o un iPad con iPadOS 13+ que Safari reporta como
  // Macintosh. Los dos botones de una — no hay plataforma detectada de la que esconder nada.
  return {
    apple: true,
    google: googleDisponible,
    link: false,
    notaSafari: true,
  };
}

// La billetera cuyo botón ve el cliente DE ENTRADA en la pantalla de éxito, para que el subtítulo
// de arriba ("Agrégala a ___ y …", `promesaTarjetaLista` en lib/tarjetas/textosPorTipo.ts) nombre
// ESE botón. 'ambas' = los dos a la vista (computadora con Google disponible).
//
// El tipo vive acá y no en textosPorTipo porque es un dato de los botones, no del texto: la
// dependencia va en una sola dirección (textosPorTipo importa este tipo; este módulo no importa nada).
export type BilleteraDeEntrada = 'apple' | 'google' | 'ambas';

// POR QUÉ EXISTE (Tarea 6b del plan Wallet/logos): hasta el 2026-09-23 el subtítulo decía "tu Apple
// Wallet" en todas las plataformas, encima de un Android que solo veía "Agregar a Google Wallet".
//
// Sale de `botonesWallet` y NO de la plataforma a secas: un Android sin Google disponible ve el
// botón de Apple (ver la rama 'android' de arriba) y tiene que leer "Apple Wallet", no "Google".
// Con `mostrarOtro: false` fijo porque el subtítulo nombra lo que se ve de entrada: no cambia si el
// cliente toca "¿Tienes otro teléfono?" (ese link es un escape por si la detección falló, no un
// cambio de billetera).
export function billeteraDeEntrada({
  plataforma,
  googleDisponible,
}: Omit<BotonesWalletEntrada, 'mostrarOtro'>): BilleteraDeEntrada {
  const { apple, google } = botonesWallet({ plataforma, googleDisponible, mostrarOtro: false });
  if (apple && google) return 'ambas';
  // Sin ninguno de los dos no se llega: Apple no depende de nada, así que siempre que Google no
  // está a la vista, Apple sí (las tres ramas de `botonesWallet`).
  return google ? 'google' : 'apple';
}

// La frase de la pantalla de registro ("Directo en tu ___, sin apps y sin plásticos.") ANTES de que
// el cliente sepa qué botón va a ver: prometerle "tu Apple Wallet" a alguien de Android es una
// promesa que ese botón no cumple. Tuteo — la lee el CLIENTE FINAL (regla "OJO CON EL TRATO" de
// lib/tarjetas/textosPorTipo.ts).
export function fraseWalletDelFormulario(plataforma: Plataforma): string {
  if (plataforma === 'ios') return 'Directo en tu Apple Wallet';
  if (plataforma === 'android') return 'Directo en tu Google Wallet';
  return 'Directo en la billetera de tu teléfono';
}
