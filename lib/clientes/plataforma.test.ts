// Mutaciones CONFIRMADAS (corridas y revertidas a mano, Tarea 1 del plan de Wallet/logos):
// - Quitar `iPad` de la regex de detectarPlataforma → el iPad viejo (iOS 12) cae a 'otra'. La
//   prueba "un iPad VIEJO (iOS 12) da 'ios'" falla con `expected 'otra' to be 'ios'`.
// - Quitar `iPhone` de la misma regex → los tres casos de iPhone (Safari, Chrome CriOS, WhatsApp)
//   caen a 'otra'. Las pruebas de esos tres casos fallan con `expected 'otra' to be 'ios'`.
// - En botonesWallet, en la rama 'android', mostrar el link también sin Google disponible
//   (`link: !mostrarOtro` en vez de `link: googleDisponible && !mostrarOtro`) → la prueba
//   "android sin Google: solo Apple, sin link" falla con `expected true to be false`.
// - En la rama 'otra', devolver `google: false` fijo (en vez de `googleDisponible`) → la prueba
//   "'otra': los dos disponibles" falla con `expected false to be true` en `google`.
// - Devolver `notaSafari: apple` en la rama 'android' (en vez de `false` fijo) → la prueba
//   "android con Google revelado: nunca la nota de Safari" falla con `expected true to be false`.
import { describe, it, expect } from 'vitest';
import { detectarPlataforma, botonesWallet, fraseWalletDelFormulario } from './plataforma';

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
    // WhatsApp abre los links en un WKWebView propio: no agrega un token distintivo al UA, sigue
    // diciendo iPhone/AppleWebKit como Safari.
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
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36';
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

  it('"otra", Google disponible: los dos de una, sin link, con la nota de Safari', () => {
    expect(botonesWallet({ plataforma: 'otra', googleDisponible: true, mostrarOtro: false })).toEqual({
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
