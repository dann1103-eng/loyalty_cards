import { describe, it, expect } from 'vitest';
import { construirReverso, escaparHtml, type CampoReverso, type DatosReverso } from './construirReverso';

// El texto del emisor se aserta CARÁCTER POR CARÁCTER (y no comparando contra EMISOR_CARDLY):
// si alguien "arregla" el sitio quitándole el `www`, la constante y la prueba cambiarían juntas y
// nadie se enteraría. El dominio raíz redirige, y esa redirección ya rompió el registro de passes
// en producción el 2026-07-26.
const PIE_EMISOR = 'Cardly SV\nsoporte@cardly-sv.site\nwww.cardly-sv.site';

// Comercio recién creado: ninguna regla, ninguna recompensa, nada configurado. Es un estado REAL
// (ni reglas_puntos ni recompensas reciben filas por defecto, y crearComercio no inserta ninguna).
function datosBase(): DatosReverso {
  return {
    nombreComercio: 'Cafetería Piloto',
    tipoTarjeta: 'puntos',
    selloMeta: null,
    mostrarComoFunciona: true,
    terminosUso: null,
    redInstagram: null,
    redFacebook: null,
    redWhatsapp: null,
    sitioWeb: null,
    reglas: [],
    recompensas: [],
  };
}

// El otro extremo: todo lo que el reverso puede mostrar, para probar orden y completitud.
function datosCompletos(): DatosReverso {
  return {
    ...datosBase(),
    terminosUso: '1. Los puntos no tienen valor monetario.',
    redInstagram: 'https://instagram.com/cafeteria',
    redFacebook: 'https://facebook.com/cafeteria',
    redWhatsapp: 'https://wa.me/50370000000',
    sitioWeb: 'https://cafeteria.example.com',
    reglas: [{ tipo: 'por_visita', valor: 2, activa_desde: '2026-01-01T00:00:00Z' }],
    recompensas: [{ nombre: 'Café gratis', descripcion: 'Cualquier tamaño.', costo_puntos: 10 }],
  };
}

function claves(campos: CampoReverso[]): string[] {
  return campos.map((campo) => campo.key);
}

function textoComoFunciona(campos: CampoReverso[]): string | undefined {
  return campos.find((campo) => campo.key === 'como_funciona')?.value;
}

describe('construirReverso — el comercio sin nada configurado', () => {
  it('produce EXACTAMENTE dos campos: empresa y emisor', () => {
    const campos = construirReverso(datosBase());

    // Ni un encabezado huérfano ni un campo con la palabra "null": las secciones vacías
    // desaparecen enteras.
    expect(claves(campos)).toEqual(['empresa', 'emisor']);
    expect(campos[0].value).toBe('Cafetería Piloto');
    expect(campos[1].value).toBe(PIE_EMISOR);
  });

  it('el campo del emisor va sin attributedValue y sin dataDetectorTypes', () => {
    const emisor = construirReverso(datosBase()).find((campo) => campo.key === 'emisor')!;

    // attributedValue solo admite <a>: no hay forma de apilar tres líneas ahí, así que el pie va
    // por value. Y dataDetectorTypes se OMITE — fijarla RESTRINGE los detectores de iOS a los
    // listados, y el correo podría quedar como texto muerto justo después de haberlo comprado.
    expect(emisor.attributedValue).toBeUndefined();
    expect('dataDetectorTypes' in emisor).toBe(false);
  });
});

describe('construirReverso — todo campo lleva value', () => {
  // LA PRUEBA MÁS IMPORTANTE DEL ARCHIVO. `value` es .required() en el esquema Joi de
  // passkit-generator (schemas/PassFieldContent.js) y FieldsArray ATRAPA el error de validación y
  // descarta el campo con un console.warn, SIN lanzar (FieldsArray.js, registerWithValidation).
  // Un campo armado solo con attributedValue desaparece del pass en silencio y nadie se entera
  // hasta que un cliente reporta que no ve sus redes.
  const escenarios: [string, DatosReverso][] = [
    ['comercio recién creado', datosBase()],
    ['todo configurado', datosCompletos()],
    ['solo redes', { ...datosBase(), redInstagram: 'https://instagram.com/x', sitioWeb: 'https://x.example.com' }],
    ['solo la sección automática', { ...datosBase(), recompensas: [{ nombre: 'Postre', descripcion: null, costo_puntos: 5 }] }],
    ['solo términos', { ...datosBase(), terminosUso: 'No acumulable.' }],
  ];

  for (const [nombre, datos] of escenarios) {
    it(`ningún campo queda sin value (${nombre})`, () => {
      const campos = construirReverso(datos);
      expect(campos.length).toBeGreaterThan(0);

      for (const campo of campos) {
        expect(
          typeof campo.value === 'string' && campo.value.length > 0,
          `El campo "${campo.key}" no lleva "value". passkit-generator lo descarta con un console.warn y desaparece del pass en silencio.`,
        ).toBe(true);
      }
    });
  }
});

describe('construirReverso — una línea por TIPO de regla', () => {
  it('con tres filas por_visita emite UNA sola línea: la de activa_desde más reciente', () => {
    // reglas_puntos NO tiene unique por tipo y crearRegla no deduplica: tres filas por_visita
    // imprimirían tres líneas contradictorias en la tarjeta del cliente. La más reciente (5) está
    // en el medio del arreglo a propósito, para que ni "la primera" ni "la última" acierten por azar.
    const campos = construirReverso({
      ...datosBase(),
      reglas: [
        { tipo: 'por_visita', valor: 1, activa_desde: '2026-01-01T00:00:00Z' },
        { tipo: 'por_visita', valor: 5, activa_desde: '2026-07-01T00:00:00Z' },
        { tipo: 'por_visita', valor: 2, activa_desde: '2026-03-01T00:00:00Z' },
      ],
    });

    expect(textoComoFunciona(campos)).toBe('Ganás 5 puntos por cada visita.');
  });

  it('compara instantes y no cadenas: dos offsets distintos se ordenan bien', () => {
    // '2026-06-30T20:00:00-06:00' es 2026-07-01T02:00:00Z — POSTERIOR a '2026-07-01T00:00:00+00:00'.
    // Ordenando las cadenas como texto, '2026-06-30…' < '2026-07-01…' y ganaría la vieja.
    const campos = construirReverso({
      ...datosBase(),
      reglas: [
        { tipo: 'por_visita', valor: 3, activa_desde: '2026-07-01T00:00:00+00:00' },
        { tipo: 'por_visita', valor: 9, activa_desde: '2026-06-30T20:00:00-06:00' },
      ],
    });

    expect(textoComoFunciona(campos)).toBe('Ganás 9 puntos por cada visita.');
  });

  it('un comercio con los dos tipos emite dos líneas: primero visita, después monto', () => {
    const campos = construirReverso({
      ...datosBase(),
      reglas: [
        { tipo: 'por_monto', valor: 3, activa_desde: '2026-01-01T00:00:00Z' },
        { tipo: 'por_visita', valor: 2, activa_desde: '2026-01-01T00:00:00Z' },
      ],
    });

    expect(textoComoFunciona(campos)).toBe(
      'Ganás 2 puntos por cada visita.\nGanás 3 puntos por cada $1 de compra.',
    );
  });
});

describe('construirReverso — unidad y número', () => {
  it('singular con cantidad exactamente 1, plural con el resto (reglas y recompensas)', () => {
    const campos = construirReverso({
      ...datosBase(),
      reglas: [{ tipo: 'por_visita', valor: 1, activa_desde: '2026-01-01T00:00:00Z' }],
      recompensas: [
        { nombre: 'Café gratis', descripcion: null, costo_puntos: 1 },
        { nombre: 'Combo', descripcion: null, costo_puntos: 2 },
      ],
    });

    expect(textoComoFunciona(campos)).toBe(
      'Ganás 1 punto por cada visita.\n• Café gratis — 1 punto\n• Combo — 2 puntos',
    );
  });

  it('tipo_tarjeta "sellos" cambia la unidad y agrega la meta después de las reglas', () => {
    const campos = construirReverso({
      ...datosBase(),
      tipoTarjeta: 'sellos',
      selloMeta: 10,
      reglas: [{ tipo: 'por_visita', valor: 1, activa_desde: '2026-01-01T00:00:00Z' }],
      recompensas: [{ nombre: 'Postre', descripcion: null, costo_puntos: 10 }],
    });

    expect(textoComoFunciona(campos)).toBe(
      'Ganás 1 sello por cada visita.\nCompletá tus 10 sellos.\n• Postre — 10 sellos',
    );
  });

  it('formatea sin ceros de relleno: 1 y no 1.00, 0.5 y no 0.50', () => {
    // reglas_puntos.valor es numeric y FormularioRegla acepta step="0.01".
    const campos = construirReverso({
      ...datosBase(),
      reglas: [
        { tipo: 'por_visita', valor: 1.0, activa_desde: '2026-01-01T00:00:00Z' },
        { tipo: 'por_monto', valor: 0.5, activa_desde: '2026-01-01T00:00:00Z' },
      ],
    });

    expect(textoComoFunciona(campos)).toBe(
      'Ganás 1 punto por cada visita.\nGanás 0.5 puntos por cada $1 de compra.',
    );
  });
});

describe('construirReverso — cuándo aparece la sección automática', () => {
  it('sello_meta NO la revive: con meta pero sin reglas ni recompensas, la sección no existe', () => {
    // "Completá tus 10 sellos." a solas, sin decir cómo se consigue uno ni qué se gana al
    // completarlos, no le sirve a nadie. La meta es un complemento, no un motivo.
    const campos = construirReverso({ ...datosBase(), tipoTarjeta: 'sellos', selloMeta: 10 });

    expect(claves(campos)).toEqual(['empresa', 'emisor']);
  });

  it('el interruptor apagado la quita aunque haya reglas y recompensas', () => {
    const campos = construirReverso({ ...datosCompletos(), mostrarComoFunciona: false });

    expect(claves(campos)).not.toContain('como_funciona');
    // El resto del reverso sobrevive: el interruptor apaga UNA sección, no el reverso entero.
    expect(claves(campos)).toEqual(['terminos', 'instagram', 'facebook', 'whatsapp', 'sitio', 'empresa', 'emisor']);
  });

  it('con recompensas y sin reglas, emite solo la parte de recompensas', () => {
    const campos = construirReverso({
      ...datosBase(),
      recompensas: [{ nombre: 'Café gratis', descripcion: 'Cualquier tamaño.', costo_puntos: 10 }],
    });

    // La descripción va en la línea siguiente: son las palabras del propio dueño.
    expect(textoComoFunciona(campos)).toBe('• Café gratis — 10 puntos\nCualquier tamaño.');
  });

  it('con reglas y sin recompensas, emite solo la parte de reglas', () => {
    const campos = construirReverso({
      ...datosBase(),
      reglas: [{ tipo: 'por_monto', valor: 2, activa_desde: '2026-01-01T00:00:00Z' }],
    });

    expect(textoComoFunciona(campos)).toBe('Ganás 2 puntos por cada $1 de compra.');
  });

  it('respeta el orden de recompensas que recibe (el llamador las trae por costo ascendente)', () => {
    // Esta función es PURA: no ordena ni filtra por `activa`. El .order()/.eq('activa', true) vive
    // en la consulta, y esta prueba fija ese contrato para que nadie lo mueva de lugar a medias.
    const campos = construirReverso({
      ...datosBase(),
      recompensas: [
        { nombre: 'Barata', descripcion: null, costo_puntos: 5 },
        { nombre: 'Cara', descripcion: null, costo_puntos: 50 },
      ],
    });

    expect(textoComoFunciona(campos)).toBe('• Barata — 5 puntos\n• Cara — 50 puntos');
  });
});

describe('construirReverso — orden y forma de los campos', () => {
  it('emite las ocho claves en el orden del spec §3', () => {
    const campos = construirReverso(datosCompletos());

    expect(claves(campos)).toEqual([
      'como_funciona',
      'terminos',
      'instagram',
      'facebook',
      'whatsapp',
      'sitio',
      'empresa',
      'emisor',
    ]);
    expect(campos.map((campo) => campo.label)).toEqual([
      'Cómo funciona',
      'Términos de uso',
      'Instagram',
      'Facebook',
      'WhatsApp',
      'Sitio web',
      'Nombre de empresa',
      'Información del emisor',
    ]);
  });

  it('los términos vacíos o solo-espacios no producen un campo en blanco', () => {
    expect(claves(construirReverso({ ...datosBase(), terminosUso: '   \n  ' }))).toEqual(['empresa', 'emisor']);
    expect(claves(construirReverso({ ...datosBase(), terminosUso: '' }))).toEqual(['empresa', 'emisor']);
  });

  it('cada red lleva la URL cruda en value y un <a> en attributedValue', () => {
    const campos = construirReverso(datosCompletos());
    const instagram = campos.find((campo) => campo.key === 'instagram')!;

    // value con la URL en texto plano: es lo que el cliente ve si el link no se renderiza.
    expect(instagram.value).toBe('https://instagram.com/cafeteria');
    expect(instagram.attributedValue).toBe('<a href="https://instagram.com/cafeteria">Instagram</a>');

    const whatsapp = campos.find((campo) => campo.key === 'whatsapp')!;
    expect(whatsapp.attributedValue).toBe('<a href="https://wa.me/50370000000">WhatsApp</a>');
  });

  it('ningún campo fija dataDetectorTypes (omitirla deja activos todos los detectores de iOS)', () => {
    for (const campo of construirReverso(datosCompletos())) {
      expect('dataDetectorTypes' in campo, `El campo "${campo.key}" fija dataDetectorTypes`).toBe(false);
    }
  });

  it('la sección "Cómo funciona" y los términos van en value, nunca en attributedValue', () => {
    // Contienen texto del dueño (recompensas.nombre/descripcion, términos) sin escapar: meterlo en
    // un campo que se interpreta como HTML sería exponerlo sin ninguna ganancia — no llevan links.
    const campos = construirReverso(datosCompletos());

    expect(campos.find((campo) => campo.key === 'como_funciona')!.attributedValue).toBeUndefined();
    expect(campos.find((campo) => campo.key === 'terminos')!.attributedValue).toBeUndefined();
    expect(campos.find((campo) => campo.key === 'empresa')!.attributedValue).toBeUndefined();
  });
});

describe('escaparHtml', () => {
  it('escapa el & PRIMERO: al revés, "<b>" saldría como "&amp;lt;b&amp;gt;"', () => {
    expect(escaparHtml('<b>')).toBe('&lt;b&gt;');
    expect(escaparHtml('&<')).toBe('&amp;&lt;');
    expect(escaparHtml('a & b')).toBe('a &amp; b');
    expect(escaparHtml('"x"')).toBe('&quot;x&quot;');
    expect(escaparHtml("'y'")).toBe('&#39;y&#39;');
  });

  it('una URL con comillas no rompe el href del attributedValue', () => {
    const campos = construirReverso({
      ...datosBase(),
      redInstagram: 'https://instagram.com/x"><script>alert(1)</script>',
    });
    const instagram = campos.find((campo) => campo.key === 'instagram')!;

    // El href queda con un solo par de comillas: el atributo no se cierra antes de tiempo y el
    // <script> nunca llega a ser marcado.
    expect(instagram.attributedValue).toBe(
      '<a href="https://instagram.com/x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">Instagram</a>',
    );
    // El value NO se escapa: es texto plano, no HTML. Escaparlo le mostraría "&quot;" al cliente.
    expect(instagram.value).toBe('https://instagram.com/x"><script>alert(1)</script>');
  });
});
