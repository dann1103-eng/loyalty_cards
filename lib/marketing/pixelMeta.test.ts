import { describe, expect, it } from 'vitest';
import { idPixelValido, numeroWhatsAppValido, reclamarEvento, rutaAdmitePixel } from './pixelMeta';

describe('rutaAdmitePixel', () => {
  it('admite las páginas públicas de mercadeo', () => {
    expect(rutaAdmitePixel('/')).toBe(true);
    expect(rutaAdmitePixel('/registro-comercio')).toBe(true);
  });

  it('excluye el registro del cliente final, con y sin programa', () => {
    expect(rutaAdmitePixel('/registro')).toBe(false);
    expect(rutaAdmitePixel('/registro/pupuseria-la-esquina')).toBe(false);
    expect(rutaAdmitePixel('/registro/pupuseria-la-esquina/sellos')).toBe(false);
  });

  // `/registro-comercio` empieza con "/registro": un startsWith sin la barra lo apagaría, y es
  // justo la página donde se mide CompleteRegistration.
  it('no confunde el alta del dueño con el registro del cliente', () => {
    expect(rutaAdmitePixel('/registro-comercio')).toBe(true);
  });

  it('excluye el portal del cliente final', () => {
    expect(rutaAdmitePixel('/mi-tarjeta')).toBe(false);
  });

  it('excluye el panel del dueño, incluidas las páginas sin sesión', () => {
    expect(rutaAdmitePixel('/comercio/panel')).toBe(false);
    expect(rutaAdmitePixel('/comercio/clientes/abc')).toBe(false);
    expect(rutaAdmitePixel('/comercio/login')).toBe(false);
    expect(rutaAdmitePixel('/comercio/activar')).toBe(false);
  });

  it('excluye el panel interno de FM', () => {
    expect(rutaAdmitePixel('/admin')).toBe(false);
    expect(rutaAdmitePixel('/admin/cuentas/1')).toBe(false);
  });

  it('tolera la barra final', () => {
    expect(rutaAdmitePixel('/registro/')).toBe(false);
    expect(rutaAdmitePixel('/comercio/')).toBe(false);
  });
});

describe('idPixelValido', () => {
  it('acepta el ID numérico, recortando espacios', () => {
    expect(idPixelValido('1387090773585494')).toBe('1387090773585494');
    expect(idPixelValido(' 1387090773585494\n')).toBe('1387090773585494');
  });

  it('rechaza vacío, ausente y cualquier cosa que no sea solo dígitos', () => {
    expect(idPixelValido(undefined)).toBeNull();
    expect(idPixelValido('')).toBeNull();
    expect(idPixelValido('1387090773585494\');alert(1)//')).toBeNull();
    expect(idPixelValido('abc')).toBeNull();
    expect(idPixelValido('123')).toBeNull();
  });
});

describe('numeroWhatsAppValido', () => {
  it('acepta el número internacional con o sin + y espacios', () => {
    expect(numeroWhatsAppValido('50370001234')).toBe('50370001234');
    expect(numeroWhatsAppValido('+503 7000 1234')).toBe('50370001234');
  });

  it('rechaza ausente, vacío y números sin código de país', () => {
    expect(numeroWhatsAppValido(undefined)).toBeNull();
    expect(numeroWhatsAppValido('')).toBeNull();
    expect(numeroWhatsAppValido('7000-1234')).toBeNull();
    expect(numeroWhatsAppValido('wa.me/50370001234')).toBeNull();
  });
});

function almacenFalso() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => void datos.set(clave, valor),
  };
}

describe('reclamarEvento', () => {
  it('la primera vez reclama y la segunda no, para la misma acción', () => {
    const almacen = almacenFalso();
    const memoria = new Set<string>();
    expect(reclamarEvento(almacen, memoria, 'CompleteRegistration', 'comercio-1')).toBe(true);
    expect(reclamarEvento(almacen, memoria, 'CompleteRegistration', 'comercio-1')).toBe(false);
  });

  // La recarga pierde la memoria de la página pero no el almacén: es la guarda contra recargas.
  it('sobrevive a una recarga (memoria nueva, mismo almacén)', () => {
    const almacen = almacenFalso();
    expect(reclamarEvento(almacen, new Set(), 'CompleteRegistration', 'comercio-1')).toBe(true);
    expect(reclamarEvento(almacen, new Set(), 'CompleteRegistration', 'comercio-1')).toBe(false);
  });

  it('acciones y eventos distintos no se pisan', () => {
    const almacen = almacenFalso();
    const memoria = new Set<string>();
    expect(reclamarEvento(almacen, memoria, 'CompleteRegistration', 'comercio-1')).toBe(true);
    expect(reclamarEvento(almacen, memoria, 'CompleteRegistration', 'comercio-2')).toBe(true);
    expect(reclamarEvento(almacen, memoria, 'Lead', 'comercio-1')).toBe(true);
  });

  // Safari en privado y los navegadores que bloquean datos del sitio LANZAN al tocar el almacén.
  // Sin almacén la guarda cae a la memoria de la página: igual una sola vez mientras no recargue.
  it('sin almacén usable, sigue siendo una sola vez por página', () => {
    const roto = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const memoria = new Set<string>();
    expect(reclamarEvento(roto, memoria, 'Lead', 'envio-1')).toBe(true);
    expect(reclamarEvento(roto, memoria, 'Lead', 'envio-1')).toBe(false);
    expect(reclamarEvento(null, memoria, 'Lead', 'envio-1')).toBe(false);
  });
});
