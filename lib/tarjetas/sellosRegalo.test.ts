import { describe, it, expect } from 'vitest';
import {
  validarSellosRegalo,
  sellosRegaloDesdeFormulario,
  describirArranque,
  textoRegaloRegistro,
  avisoRegaloAlcanzaPremio,
  contadorDeRespuesta,
} from './sellosRegalo';

// Pruebas de la regla pura de los sellos de regalo (lib/tarjetas/sellosRegalo.ts). Corren sin
// Supabase ni .env.local: el módulo no importa nada.
//
// Mutation-testing CONFIRMADO (2026-10-28), cada mutación restaurada después de correrla. Entre
// paréntesis, lo que la prueba recibió de más o de menos al fallar:
//
// - `>=` → `>` en la regla 4: fallan "igual a la meta (10 de 10)" y "1 con meta 1" (devuelven null en
//   vez del mensaje).
// - `>=` → `>= selloMeta - 1` en la regla 4 (el tope un sello corto): fallan "meta menos 1 (9 de 10)"
//   y "1 con meta 2" (rechazan un regalo válido con el mensaje de la regla 4). Entre las dos mutaciones
//   el operador y el borde quedan acotados por los dos lados.
// - Quitar la regla 3 (meta null): fallan las tres pruebas de la regla 3. Sin ella, `2 >= null` es
//   true y el dueño leería "...menos que la meta (null)..." en vez de "Poné la meta de sellos...".
// - Quitar la regla 4 entera: fallan "igual a la meta", "mayor que la meta (11 de 10)", "el mensaje
//   nombra la meta" y "1 con meta 1".
// - Fijar el 10 en el mensaje de la regla 4 (`(${selloMeta})` → `(10)`): fallan "el mensaje nombra la
//   meta del programa" (recibe "(10)" y espera "(5)") y "1 con meta 1".
// - Quitar `|| sellosRegalo < 0` de la regla 1: falla "-1" con meta 10 (devuelve null: -1 pasaba por
//   "menos que la meta") y "-1" con meta null (devuelve el mensaje de la regla 3, "Poné la meta de
//   sellos antes de regalar sellos.", en vez del de la regla 1).
// - Quitar `!Number.isInteger(...)` de la regla 1: fallan NaN y 1.5 (con meta 10 y con null), Infinity
//   y "'2a' → lo rechaza la regla 1" (devuelven null, o el mensaje de la regla 3 o 4, en vez del de la
//   regla 1: un NaN no pasa ninguna comparación).
// - Quitar la regla 2 (`=== 0 → null`): fallan "0 con meta null" y "campo ausente + programa sin
//   meta" (devuelven el mensaje de la regla 3 para un programa que ni usa el regalo).
// - Poner la regla 3 antes que la 1: fallan NaN, 1.5 y -1 con meta null (el dueño leería "Poné la
//   meta" sobre un valor que está roto), "0 con meta null" y "campo ausente + programa sin meta".
// - `ausente → 0` cambiado a `ausente → NaN`: fallan "ausente (null) → 0" (`expected NaN to be +0`)
//   y "campo ausente + programa sin meta → válido".
// - `Number(valor)` → `parseInt(valor, 10)`: fallan "vacío", "solo espacios" (NaN en vez de 0), "'2a'
//   → NaN" (daba 2), "'1.5' y '-1'" y "'2a' → lo rechaza la regla 1".
// - `Number(valor)` → `Number(valor) || 0` (el NaN "defensivo" que lo vuelve 0): fallan "'2a' → NaN",
//   "un archivo en vez de un número" y "'2a' → lo rechaza la regla 1" (`expected +0 to be NaN`).
// - Tratar lo que no es string como ausente (`typeof valor === 'string' ? Number(valor) : 0`): falla
//   "un archivo en vez de un número → NaN, no 0".
// - `describirArranque`: `faltan = selloMeta - sellosRegalo` → `selloMeta` (falla en las 5 pruebas,
//   "le faltan 10" en vez de "le faltan 8"), e intercambiar regalo y meta en el texto (las 5 pruebas,
//   "arranca con 10 de 2"). Por eso el caso 3 de 7 trae tres cifras distintas. El singular (confirmadas
//   2026-10-28, restauradas): "siempre plural" (`verbo = 'le faltan'`) falla SOLO "9 de 10: le falta 1"
//   (`Expected: "…sellos: le falta 1. Es un…"`, `Received: "…sellos: le faltan 1. Es un…"`); "siempre
//   singular" falla las otras 4 (2 de 10, 1 de 10, 3 de 7 y 8 de 10); y `faltan <= 2` en vez de
//   `=== 1` falla SOLO "8 de 10: le faltan 2" (por eso existe: acota el singular por arriba).
// - `textoRegaloRegistro`: singular roto (`=== 1 ? 'sellos' : 'sellos'`) falla "1 → singular"
//   ("1 sellos de regalo"); singular de más (`<= 2`) falla "2 → plural" ("2 sello de regalo").
// - `avisoRegaloAlcanzaPremio` (mutaciones confirmadas 2026-10-28, cada una restaurada después):
//   `<` → `<=` en la comparación con el costo (regalo igual al costo ya no avisa): falla "regalo IGUAL
//   al costo (5 de 5)" (`expected null to be 'Con 5 de regalo…'`); el tope un sello corto
//   (`< costo - 1`): falla "regalo UN sello menos que el costo (4 de 5)" (`expected 'Con 4 de regalo…'
//   to be null`); ignorar el null (sacar la guarda de la recompensa): falla "sin recompensa" con
//   `TypeError: Cannot read properties of null (reading 'costoPuntos')`; nombre fijo («Premio») en
//   vez del de la recompensa: fallan "5 de 5", "7 de 5" y "el nombre sale de la recompensa"; usar el
//   costo en vez del regalo en el texto: fallan "7 de 5" (`Con 5` en vez de `Con 7`) y "el nombre
//   sale de la recompensa"; sacar la guarda `<= 0`: falla "regalo 0 o negativo → null aun si el costo
//   fuera 0" (`expected 'Con 0 de regalo…' to be null`); sacar la guarda de entero: falla "un regalo
//   que no es entero" (`expected 'Con NaN de regalo…' to be null`).
//
// Dos cosas del código que NO tienen mutación posible, y no es un hueco: `.trim()` y un caso aparte
// para el vacío no existen en `sellosRegaloDesdeFormulario` porque `Number('')`, `Number('  ')` y
// `Number(' 2 ')` ya dan 0, 0 y 2 (esos tres valores están fijados acá abajo); agregarlos sería código
// muerto que ninguna prueba podría distinguir. Y `=== 0` → `<= 0` en la regla 2 es equivalente: los
// negativos ya los frenó la regla 1.
//
// Los mensajes se comparan EXACTOS (toBe sobre el literal, nunca una regex): es lo que lee el dueño
// en Marca, y una prueba floja dejaría pasar un mensaje cambiado por otro que también "suena bien".
// Los literales son copia a mano de la spec (3.2), no se arman con el código bajo prueba: así un
// cambio en el módulo no arrastra a la prueba consigo.
const MSG_NO_ENTERO = 'Los sellos de regalo tienen que ser un número entero, 0 o más.';
const MSG_SIN_META = 'Poné la meta de sellos antes de regalar sellos.';

describe('validarSellosRegalo', () => {
  describe('regla 1: entero, 0 o más', () => {
    // Se prueba contra una meta válida Y contra "sin meta": la regla 1 va ANTES que la 3, así que
    // un valor roto tiene que decir que está roto, no que falta la meta.
    for (const meta of [10, null]) {
      it(`NaN con meta ${meta} → no entero`, () => {
        expect(validarSellosRegalo(meta, NaN)).toBe(MSG_NO_ENTERO);
      });

      it(`1.5 con meta ${meta} → no entero`, () => {
        expect(validarSellosRegalo(meta, 1.5)).toBe(MSG_NO_ENTERO);
      });

      it(`-1 con meta ${meta} → no entero, 0 o más`, () => {
        expect(validarSellosRegalo(meta, -1)).toBe(MSG_NO_ENTERO);
      });
    }

    it('Infinity → no entero (un campo "1e999" llega como Infinity)', () => {
      expect(validarSellosRegalo(10, Infinity)).toBe(MSG_NO_ENTERO);
      expect(validarSellosRegalo(10, -Infinity)).toBe(MSG_NO_ENTERO);
    });
  });

  describe('regla 2: 0 es válido con cualquier meta', () => {
    it('0 con meta null → null: el default de todo programa, y los que no son de sellos', () => {
      expect(validarSellosRegalo(null, 0)).toBeNull();
    });

    it('0 con meta 10 → null', () => {
      expect(validarSellosRegalo(10, 0)).toBeNull();
    });

    it('0 con meta 1 → null: apagar el regalo nunca se rechaza', () => {
      expect(validarSellosRegalo(1, 0)).toBeNull();
    });
  });

  describe('regla 3: regalar exige meta', () => {
    it('2 con meta null → "Poné la meta..."', () => {
      expect(validarSellosRegalo(null, 2)).toBe(MSG_SIN_META);
    });

    it('1 con meta null → lo mismo: no importa cuán chico sea el regalo', () => {
      expect(validarSellosRegalo(null, 1)).toBe(MSG_SIN_META);
    });

    it('un regalo enorme con meta null → sigue siendo la regla 3, no la 4', () => {
      // Sin meta no hay "menos que la meta" que comparar: el dueño tiene que leer qué le falta.
      expect(validarSellosRegalo(null, 500)).toBe(MSG_SIN_META);
    });
  });

  describe('regla 4: menos que la meta', () => {
    it('igual a la meta (10 de 10) → rechazado: la tarjeta nacería completa', () => {
      expect(validarSellosRegalo(10, 10)).toBe(
        'Los sellos de regalo tienen que ser menos que la meta (10): si no, la tarjeta nacería completa.',
      );
    });

    it('meta menos 1 (9 de 10) → aceptado: el borde de arriba', () => {
      expect(validarSellosRegalo(10, 9)).toBeNull();
    });

    it('mayor que la meta (11 de 10) → rechazado', () => {
      expect(validarSellosRegalo(10, 11)).toBe(
        'Los sellos de regalo tienen que ser menos que la meta (10): si no, la tarjeta nacería completa.',
      );
    });

    it('el mensaje nombra la meta del programa, no un 10 fijo', () => {
      expect(validarSellosRegalo(5, 7)).toBe(
        'Los sellos de regalo tienen que ser menos que la meta (5): si no, la tarjeta nacería completa.',
      );
    });

    it('1 con meta 10 → aceptado: el borde de abajo', () => {
      expect(validarSellosRegalo(10, 1)).toBeNull();
    });

    it('1 con meta 2 → aceptado: la meta más chica que admite un regalo', () => {
      expect(validarSellosRegalo(2, 1)).toBeNull();
    });

    it('1 con meta 1 → rechazado: con meta 1 no cabe ningún regalo', () => {
      expect(validarSellosRegalo(1, 1)).toBe(
        'Los sellos de regalo tienen que ser menos que la meta (1): si no, la tarjeta nacería completa.',
      );
    });
  });
});

describe('sellosRegaloDesdeFormulario', () => {
  it('ausente (null) → 0, no NaN ni "no tocar"', () => {
    // El campo solo se dibuja en sellos. Si ausente significara "no tocar", un programa al que el FM
    // le cambió el tipo quedaría con meta null y regalo 2, y el CHECK de la base tumbaría TODO el
    // guardado de Marca de ese dueño.
    expect(sellosRegaloDesdeFormulario(null)).toBe(0);
  });

  it("vacío ('') → 0: el dueño borró el número para apagar el regalo", () => {
    expect(sellosRegaloDesdeFormulario('')).toBe(0);
  });

  it("solo espacios ('  ') → 0", () => {
    expect(sellosRegaloDesdeFormulario('  ')).toBe(0);
  });

  it("'2' → 2", () => {
    expect(sellosRegaloDesdeFormulario('2')).toBe(2);
  });

  it("'0' → 0", () => {
    expect(sellosRegaloDesdeFormulario('0')).toBe(0);
  });

  it("' 2 ' → 2: los espacios de alrededor no cuentan", () => {
    expect(sellosRegaloDesdeFormulario(' 2 ')).toBe(2);
  });

  it("'2a' → NaN: un typo no se arregla en silencio, lo rechaza la regla 1", () => {
    // parseInt('2a') daría 2 y guardaría un regalo que el dueño no escribió.
    expect(sellosRegaloDesdeFormulario('2a')).toBeNaN();
  });

  it("'1.5' y '-1' llegan tal cual a la regla 1 (esta función no valida)", () => {
    expect(sellosRegaloDesdeFormulario('1.5')).toBe(1.5);
    expect(sellosRegaloDesdeFormulario('-1')).toBe(-1);
  });

  it('un archivo en vez de un número → NaN, no 0', () => {
    // Un formulario armado a mano puede mandar un File bajo ese nombre. Tratarlo como ausente
    // (0) borraría el regalo del dueño en silencio; como NaN lo frena la regla 1.
    expect(sellosRegaloDesdeFormulario(new File(['2'], 'regalo.txt'))).toBeNaN();
  });

  describe('de punta a punta con validarSellosRegalo (lo que hace la Server Action)', () => {
    it('campo ausente + programa sin meta → válido: el cambio de tipo del FM no tumba Marca', () => {
      const regalo = sellosRegaloDesdeFormulario(null);
      expect(validarSellosRegalo(null, regalo)).toBeNull();
    });

    it("'2a' → lo rechaza la regla 1 con su mensaje", () => {
      const regalo = sellosRegaloDesdeFormulario('2a');
      expect(validarSellosRegalo(10, regalo)).toBe(MSG_NO_ENTERO);
    });

    it("'2' con meta 10 → válido", () => {
      const regalo = sellosRegaloDesdeFormulario('2');
      expect(validarSellosRegalo(10, regalo)).toBeNull();
    });
  });
});

describe('describirArranque', () => {
  it('2 de 10: arranca con 2, le faltan 8', () => {
    expect(describirArranque(10, 2)).toBe(
      'Un cliente nuevo arranca con 2 de 10 sellos: le faltan 8. Es un regalo de verdad, y las tarjetas que ya existen no cambian.',
    );
  });

  it('1 de 10: el regalo en singular no cambia el "de 10 sellos"', () => {
    expect(describirArranque(10, 1)).toBe(
      'Un cliente nuevo arranca con 1 de 10 sellos: le faltan 9. Es un regalo de verdad, y las tarjetas que ya existen no cambian.',
    );
  });

  it('3 de 7: cada número va en su lugar (regalo, meta, lo que falta son tres cifras distintas)', () => {
    expect(describirArranque(7, 3)).toBe(
      'Un cliente nuevo arranca con 3 de 7 sellos: le faltan 4. Es un regalo de verdad, y las tarjetas que ya existen no cambian.',
    );
  });

  it('9 de 10: le falta 1 (el borde de arriba, el regalo más grande que admite la regla)', () => {
    // Singular: "le falta 1", no "le faltan 1".
    expect(describirArranque(10, 9)).toBe(
      'Un cliente nuevo arranca con 9 de 10 sellos: le falta 1. Es un regalo de verdad, y las tarjetas que ya existen no cambian.',
    );
  });

  it('8 de 10: le faltan 2 (el plural arranca en 2, no en 3)', () => {
    expect(describirArranque(10, 8)).toBe(
      'Un cliente nuevo arranca con 8 de 10 sellos: le faltan 2. Es un regalo de verdad, y las tarjetas que ya existen no cambian.',
    );
  });
});

describe('textoRegaloRegistro', () => {
  it('1 → singular: "1 sello"', () => {
    expect(textoRegaloRegistro(1)).toBe('Arrancás con 1 sello de regalo.');
  });

  it('2 → plural', () => {
    expect(textoRegaloRegistro(2)).toBe('Arrancás con 2 sellos de regalo.');
  });

  it('9 → plural: solo el 1 exacto es singular', () => {
    expect(textoRegaloRegistro(9)).toBe('Arrancás con 9 sellos de regalo.');
  });
});

describe('avisoRegaloAlcanzaPremio', () => {
  // La recompensa activa más barata del comercio: un café a 5 sellos.
  const CAFE = { nombre: 'Café gratis', costoPuntos: 5 };

  it('regalo IGUAL al costo (5 de 5) → avisa: el canje exige >=, así que ya puede canjear', () => {
    expect(avisoRegaloAlcanzaPremio(5, CAFE)).toBe(
      'Con 5 de regalo, un cliente nuevo ya puede canjear «Café gratis» sin haber comprado nada.',
    );
  });

  it('regalo UN sello menos que el costo (4 de 5) → null: todavía no alcanza', () => {
    expect(avisoRegaloAlcanzaPremio(4, CAFE)).toBeNull();
  });

  it('regalo mayor que el costo (7 de 5) → avisa con el regalo, no con el costo', () => {
    // Regalo y costo son cifras distintas a propósito: si el texto usara el costo diría "Con 5".
    expect(avisoRegaloAlcanzaPremio(7, CAFE)).toBe(
      'Con 7 de regalo, un cliente nuevo ya puede canjear «Café gratis» sin haber comprado nada.',
    );
  });

  it('el nombre sale de la recompensa que llega, no de un premio fijo', () => {
    expect(avisoRegaloAlcanzaPremio(3, { nombre: 'Almuerzo completo', costoPuntos: 2 })).toBe(
      'Con 3 de regalo, un cliente nuevo ya puede canjear «Almuerzo completo» sin haber comprado nada.',
    );
  });

  it('sin recompensa (el comercio no tiene ninguna activa) → null, con cualquier regalo', () => {
    expect(avisoRegaloAlcanzaPremio(5, null)).toBeNull();
    expect(avisoRegaloAlcanzaPremio(1, null)).toBeNull();
  });

  it('regalo 0 → null: no hay regalo que avisar', () => {
    expect(avisoRegaloAlcanzaPremio(0, CAFE)).toBeNull();
  });

  it('regalo 0 o negativo → null aun si el costo fuera 0 (una fila rara no inventa un aviso)', () => {
    // Con un costo válido (1 o más) el regalo 0 ya queda por debajo del costo y esta guarda no se
    // nota. Con costo 0 (que la app no crea, pero una fila cargada a mano podría traer) 0 >= 0 sería
    // verdad: solo la guarda del regalo 0 lo evita.
    const RARA = { nombre: 'Premio raro', costoPuntos: 0 };
    expect(avisoRegaloAlcanzaPremio(0, RARA)).toBeNull();
    expect(avisoRegaloAlcanzaPremio(-1, RARA)).toBeNull();
  });

  it('un regalo que no es entero (NaN, 1.5, Infinity) → null: no es uno que el servidor aceptaría', () => {
    // Con costo 1, los tres pasarían la comparación `regalo >= costo` y el aviso diría "Con NaN...".
    const BARATA = { nombre: 'Café gratis', costoPuntos: 1 };
    expect(avisoRegaloAlcanzaPremio(NaN, BARATA)).toBeNull();
    expect(avisoRegaloAlcanzaPremio(1.5, BARATA)).toBeNull();
    expect(avisoRegaloAlcanzaPremio(Infinity, BARATA)).toBeNull();
  });
});

// Lo que la tarjeta de muestra de "Tu tarjeta está lista" acepta de la respuesta JSON de /api/registro
// (`sellosRegalo` y `puntosActuales`). El componente es de cliente y el repo no tiene pruebas de
// componentes: el guard vive acá, puro, para poder romperlo.
//
// MUTACIONES CONFIRMADAS (2026-10-28), cada una restaurada: sacar `Number.isInteger` falla "un decimal"
// (`expected 1.5 to be +0`) y "NaN e Infinity" (`expected Infinity to be +0`); sacar `>= 0` falla "un
// negativo" (`expected -1 to be +0`); el respaldo en 1 en vez de 0 falla 4 pruebas (`expected 1 to be
// +0`); y aceptar textos numéricos con `Number(valor)` falla "lo que no es un número" (`expected 2 to
// be +0`). Lo que NO cubre ninguna prueba: que RegistroCliente.tsx le pase `puntosActuales` (y no
// `sellosRegaloRecibidos`) a la muestra; es el pegamento de un componente de cliente, se mira en el
// navegador.
describe('contadorDeRespuesta', () => {
  it('un entero de 0 en adelante pasa tal cual', () => {
    expect(contadorDeRespuesta(0)).toBe(0);
    expect(contadorDeRespuesta(2)).toBe(2);
    expect(contadorDeRespuesta(7)).toBe(7);
  });

  it('un negativo es 0: una muestra con "-1 de 10" sería inventar un saldo', () => {
    expect(contadorDeRespuesta(-1)).toBe(0);
  });

  it('un decimal es 0: un contador de sellos no es 1.5', () => {
    expect(contadorDeRespuesta(1.5)).toBe(0);
  });

  it('NaN e Infinity son 0', () => {
    expect(contadorDeRespuesta(NaN)).toBe(0);
    expect(contadorDeRespuesta(Infinity)).toBe(0);
  });

  it('lo que no es un número (campo ausente, null, texto) es 0', () => {
    // El ausente es el de una versión vieja de la API que todavía no devolvía el campo.
    expect(contadorDeRespuesta(undefined)).toBe(0);
    expect(contadorDeRespuesta(null)).toBe(0);
    expect(contadorDeRespuesta('2')).toBe(0);
    expect(contadorDeRespuesta({})).toBe(0);
  });
});
