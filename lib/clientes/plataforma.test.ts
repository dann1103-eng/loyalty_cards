// Mutaciones CONFIRMADAS (corridas y revertidas a mano, Tarea 1 del plan de Wallet/logos — cada
// línea de abajo copia lo que VITEST imprimió en la corrida real, no lo que se esperaba que
// imprimiera; la versión anterior de este encabezado se escribió al revés y quedó mal en tres
// puntos, ver la revisión del commit 8750ae3).
//
// - Quitar `iPad` de la regex de `detectarPlataforma` → cae 1 prueba: "un iPad VIEJO (iOS 12, el UA
//   dice "iPad") da "ios"", con `Expected: "ios"` / `Received: "otra"`.
// - Quitar `iPhone` de la misma regex → caen 4 pruebas (no 3): "Safari en iPhone (iOS 17) da "ios"",
//   "Chrome en iPhone (CriOS) da "ios"", "navegador interno de WhatsApp en iPhone da "ios"" Y
//   "navegador interno de Instagram en iPhone da "ios"" — Instagram también depende de `iPhone` en
//   su UA (`iPhone14,2` es un dato dentro del token de Instagram, no del bloque de dispositivo, pero
//   el bloque de dispositivo en sí sigue diciendo `iPhone`). Las 4 con `Expected: "ios"` /
//   `Received: "otra"`.
// - En `botonesWallet`/'android', `link: !mostrarOtro` (sin exigir `googleDisponible`) → cae 1
//   prueba: "android sin Google: solo Apple, sin link (no hay nada mejor que ofrecer)". Las pruebas
//   de `botonesWallet` usan `toEqual` sobre un objeto, así que vitest no imprime "expected X to be
//   Y": imprime un diff del objeto completo — acá, `-   "link": false,` / `+   "link": true,`.
// - En la rama 'otra', `google: false` fijo (en vez de `googleDisponible`) → caen 2 pruebas (con la
//   fila nueva de la tabla 3×2×2, no 1): "'otra', Google disponible: los dos de una, sin link, con
//   la nota de Safari" y "'otra', Google disponible, con mostrarOtro en true: no cambia nada (ya
//   estaban los dos)". Diff en las dos: `-   "google": true,` / `+   "google": false,`.
// - `notaSafari: apple` en la rama 'android' (en vez de `false` fijo) → caen 3 pruebas (no 1):
//   "android, Google disponible, revelado: los dos, sin link, sin la nota de Safari", "android sin
//   Google: solo Apple, sin link (no hay nada mejor que ofrecer)" y "android sin Google, con
//   mostrarOtro en true: igual solo Apple, sin link, sin la nota de Safari" — en las tres, `apple`
//   termina siendo `true` por caminos distintos, así que las tres exponen la misma mutación. Diff en
//   las tres: `-   "notaSafari": false,` / `+   "notaSafari": true,`.
// - En la rama 'ios', `google: mostrarOtro` (sin exigir `googleDisponible`) → cae 1 prueba: "ios sin
//   Google disponible, con mostrarOtro en true (el link nunca debió tocarse: no hay nada que
//   mostrar)", diff `-   "google": false,` / `+   "google": true,`. ESTA MUTACIÓN SOBREVIVÍA (27/27
//   verde) antes de agregar esa fila: las otras dos filas de 'ios' en la tabla dan el mismo
//   resultado con o sin el `&&` (con `googleDisponible: true` el `&&` no cambia nada; con
//   `googleDisponible: false, mostrarOtro: false` el `mostrarOtro` solo ya da `false` igual). Hace
//   falta la combinación `googleDisponible: false, mostrarOtro: true` para que el `&&` importe — y
//   es justo el estado que alcanza el portal en la Tarea 2 al cambiar de una tarjeta con Google
//   (con el link ya tocado) a una sin Google: sin este `&&`, `BotonesWallet.tsx` recibiría
//   `resultado.google: true` con `urlGoogle: null`.
//
// Tarea 6b (`billeteraDeEntrada`, corridas y revertidas a mano el 2026-09-23; mismo criterio: lo
// que VITEST imprimió):
// - (a) `if (plataforma === 'android') return 'google';` al principio de la función (la billetera
//   sale de la plataforma a secas y no de `botonesWallet`) → cae 1 prueba: "android SIN Google
//   disponible: "apple" — es el único botón que ve, no el de su plataforma", con
//   `Expected: "apple"` / `Received: "google"`.
// - (c) `mostrarOtro: true` en vez de `false` en la llamada a `botonesWallet` → caen 2 pruebas:
//   "ios con Google disponible: "apple" (el de Google está detrás del link)", con
//   `Expected: "apple"` / `Received: "ambas"`, y "android con Google disponible: "google" (el de
//   Apple está detrás del link)", con `Expected: "google"` / `Received: "ambas"`.
// - (b), la frase de Google que vuelve a decir "Apple Wallet", vive en textosPorTipo.test.ts.
import { describe, it, expect } from 'vitest';
import {
  detectarPlataforma,
  botonesWallet,
  billeteraDeEntrada,
  fraseWalletDelFormulario,
} from './plataforma';

describe('detectarPlataforma', () => {
  it('Safari en iPhone (iOS 17) da "ios"', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
    expect(detectarPlataforma(ua)).toBe('ios');
  });

  it('Chrome en iPhone (CriOS) da "ios"', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.87 Mobile/15E148 Safari/604.1';
    expect(detectarPlataforma(ua)).toBe('ios');
  });

  it('navegador interno de WhatsApp en iPhone da "ios"', () => {
    // OJO: no tengo certeza del UA EXACTO que usa hoy la app de WhatsApp en iOS (no hay una fuente
    // que pueda citar con la misma confianza que para Chrome/Instagram, cuyo token es público y
    // documentado). Este es un UA representativo de un WKWebView sin token propio — el caso "no
    // agrega nada distintivo, pero conserva iPhone" — que es el comportamiento reportado de
    // WhatsApp. Si aparece evidencia de un token real, este UA debería reemplazarse por ese.
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    expect(detectarPlataforma(ua)).toBe('ios');
  });

  it('navegador interno de Instagram en iPhone da "ios"', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0.0.23.114 (iPhone14,2; iOS 16_6; en_US; en-US; scale=3.00; 1170x2532; 490037685)';
    expect(detectarPlataforma(ua)).toBe('ios');
  });

  it('un iPad VIEJO (iOS 12, el UA dice "iPad") da "ios"', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 12_5_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1';
    expect(detectarPlataforma(ua)).toBe('ios');
  });

  it('un iPad con iPadOS 13+ (dice "Macintosh") da "otra" — del lado del servidor es indistinguible de una Mac', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(detectarPlataforma(ua)).toBe('otra');
  });

  it('Chrome en Android da "android"', () => {
    // Formato real de Chrome >= 110 en Android: desde esa versión Chrome "congela" el modelo de
    // dispositivo en el UA (por reducción de fingerprinting) y manda el literal `K` en vez del
    // modelo real — no es un dato de prueba simplificado, es lo que el navegador manda de verdad.
    const ua =
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
    expect(detectarPlataforma(ua)).toBe('android');
  });

  it('Samsung Internet da "android"', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/115.0.0.0 Mobile Safari/537.36';
    expect(detectarPlataforma(ua)).toBe('android');
  });

  it('navegador interno de Instagram en Android da "android"', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 Instagram 302.0.0.23.114 Android (33/13; 420dpi; 1080x2260; samsung; SM-G991B; o1s; exynos2100; en_US; 490037685)';
    expect(detectarPlataforma(ua)).toBe('android');
  });

  it('Chrome en Windows da "otra"', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
    expect(detectarPlataforma(ua)).toBe('otra');
  });

  it('Safari en Mac da "otra"', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    expect(detectarPlataforma(ua)).toBe('otra');
  });

  it('cadena vacía da "otra"', () => {
    expect(detectarPlataforma('')).toBe('otra');
  });

  it('null (sin cabecera user-agent) da "otra"', () => {
    expect(detectarPlataforma(null)).toBe('otra');
  });
});

describe('botonesWallet', () => {
  it('ios, Google disponible, sin revelar: solo Apple + link, con la nota de Safari', () => {
    expect(botonesWallet({ plataforma: 'ios', googleDisponible: true, mostrarOtro: false })).toEqual({
      apple: true,
      google: false,
      link: true,
      notaSafari: true,
    });
  });

  it('ios, Google disponible, revelado: los dos, sin link, con la nota de Safari', () => {
    expect(botonesWallet({ plataforma: 'ios', googleDisponible: true, mostrarOtro: true })).toEqual({
      apple: true,
      google: true,
      link: false,
      notaSafari: true,
    });
  });

  it('ios sin Google disponible: solo Apple, sin link (no hay nada que revelar)', () => {
    expect(botonesWallet({ plataforma: 'ios', googleDisponible: false, mostrarOtro: false })).toEqual({
      apple: true,
      google: false,
      link: false,
      notaSafari: true,
    });
  });

  it('ios sin Google disponible, con mostrarOtro en true (el link nunca debió tocarse: no hay nada que mostrar)', () => {
    // Completa la tabla 3×2×2. Este es el caso que atrapa la mutación de `google: mostrarOtro`
    // (sin exigir `googleDisponible`) en la rama ios: sin este renglón esa mutación sobrevivía,
    // porque las otras dos filas de ios dan el mismo resultado con o sin el `&&` (ver el
    // encabezado de este archivo). Es también el estado que alcanza el portal en la Tarea 2: un
    // cliente que ya tocó el link en una tarjeta CON Google, y cambia a una tarjeta SIN Google —
    // ahí `mostrarOtro` puede seguir en true mientras `googleDisponible` ya es false.
    expect(botonesWallet({ plataforma: 'ios', googleDisponible: false, mostrarOtro: true })).toEqual({
      apple: true,
      google: false,
      link: false,
      notaSafari: true,
    });
  });

  it('android, Google disponible, sin revelar: solo Google + link, sin la nota de Safari', () => {
    expect(botonesWallet({ plataforma: 'android', googleDisponible: true, mostrarOtro: false })).toEqual({
      apple: false,
      google: true,
      link: true,
      notaSafari: false,
    });
  });

  it('android, Google disponible, revelado: los dos, sin link, sin la nota de Safari', () => {
    // El caso que motiva el link: el cliente reveló el botón de Apple (que en Android no le
    // sirve para SU billetera, pero puede necesitarlo por una razón propia), y la nota de Safari
    // sigue sin mostrarse — su navegador no es Safari aunque vea el botón de Apple.
    expect(botonesWallet({ plataforma: 'android', googleDisponible: true, mostrarOtro: true })).toEqual({
      apple: true,
      google: true,
      link: false,
      notaSafari: false,
    });
  });

  it('android sin Google: solo Apple, sin link (no hay nada mejor que ofrecer)', () => {
    expect(botonesWallet({ plataforma: 'android', googleDisponible: false, mostrarOtro: false })).toEqual({
      apple: true,
      google: false,
      link: false,
      notaSafari: false,
    });
  });

  it('android sin Google, con mostrarOtro en true: igual solo Apple, sin link, sin la nota de Safari', () => {
    // Completa la tabla: mismo caso que el de arriba, pero con `mostrarOtro` en true (el mismo
    // estado "de sobra" que puede llegar del portal al cambiar de tarjeta — ver el comentario del
    // caso análogo en ios). El resultado no cambia: sin Google, `mostrarOtro` no tiene nada que
    // revelar.
    expect(botonesWallet({ plataforma: 'android', googleDisponible: false, mostrarOtro: true })).toEqual({
      apple: true,
      google: false,
      link: false,
      notaSafari: false,
    });
  });

  it('"otra", Google disponible: los dos de una, sin link, con la nota de Safari', () => {
    expect(botonesWallet({ plataforma: 'otra', googleDisponible: true, mostrarOtro: false })).toEqual({
      apple: true,
      google: true,
      link: false,
      notaSafari: true,
    });
  });

  it('"otra", Google disponible, con mostrarOtro en true: no cambia nada (ya estaban los dos)', () => {
    // Completa la tabla: en 'otra' la función ignora `mostrarOtro` (ver la rama por defecto en
    // plataforma.ts) — este renglón lo deja asentado con una prueba, no solo con el comentario del
    // código.
    expect(botonesWallet({ plataforma: 'otra', googleDisponible: true, mostrarOtro: true })).toEqual({
      apple: true,
      google: true,
      link: false,
      notaSafari: true,
    });
  });

  it('"otra" sin Google disponible: solo Apple, sin link', () => {
    expect(botonesWallet({ plataforma: 'otra', googleDisponible: false, mostrarOtro: false })).toEqual({
      apple: true,
      google: false,
      link: false,
      notaSafari: true,
    });
  });

  it('"otra" sin Google disponible, con mostrarOtro en true: no cambia nada', () => {
    expect(botonesWallet({ plataforma: 'otra', googleDisponible: false, mostrarOtro: true })).toEqual({
      apple: true,
      google: false,
      link: false,
      notaSafari: true,
    });
  });
});

// Tarea 6b: la billetera que nombra el subtítulo de "Tu tarjeta está lista". La tabla es 3×2 y no
// 3×2×2 porque la función NO recibe `mostrarOtro`: el subtítulo nombra lo que el cliente ve DE
// ENTRADA y no cambia si después toca "¿Tienes otro teléfono?".
describe('billeteraDeEntrada', () => {
  it('ios con Google disponible: "apple" (el de Google está detrás del link)', () => {
    expect(billeteraDeEntrada({ plataforma: 'ios', googleDisponible: true })).toBe('apple');
  });

  it('ios sin Google disponible: "apple"', () => {
    expect(billeteraDeEntrada({ plataforma: 'ios', googleDisponible: false })).toBe('apple');
  });

  it('android con Google disponible: "google" (el de Apple está detrás del link)', () => {
    expect(billeteraDeEntrada({ plataforma: 'android', googleDisponible: true })).toBe('google');
  });

  it('android SIN Google disponible: "apple" — es el único botón que ve, no el de su plataforma', () => {
    // El caso por el que la función sale de `botonesWallet` y no de la plataforma a secas: un
    // comercio sin logo (o una sincronización de la clase que falló en ese momento) deja al cliente
    // de Android con el botón de Apple, y el subtítulo tiene que nombrar ESE botón.
    expect(billeteraDeEntrada({ plataforma: 'android', googleDisponible: false })).toBe('apple');
  });

  it('"otra" con Google disponible: "ambas" (los dos botones de una)', () => {
    expect(billeteraDeEntrada({ plataforma: 'otra', googleDisponible: true })).toBe('ambas');
  });

  it('"otra" sin Google disponible: "apple"', () => {
    expect(billeteraDeEntrada({ plataforma: 'otra', googleDisponible: false })).toBe('apple');
  });
});

describe('fraseWalletDelFormulario', () => {
  it('nombra la marca de la plataforma detectada', () => {
    expect(fraseWalletDelFormulario('ios')).toBe('Directo en tu Apple Wallet');
    expect(fraseWalletDelFormulario('android')).toBe('Directo en tu Google Wallet');
  });

  it('"otra" no nombra ninguna marca puntual', () => {
    expect(fraseWalletDelFormulario('otra')).toBe('Directo en la billetera de tu teléfono');
  });
});
