import { describe, it, expect } from 'vitest';
import { parsearCoordenadas, esEnlaceCortoDeMapas } from './coordenadas';

// El parseo es puro: nada de red acá. Los formatos de URL de Google son lo que más se rompe con el
// tiempo, así que cada uno queda fijado con un ejemplo real y con de dónde sale.

describe('parsearCoordenadas', () => {
  it('acepta coordenadas pegadas tal cual', () => {
    // Es lo que sale de mantener presionado un punto en el mapa y tocar las coordenadas.
    expect(parsearCoordenadas('13.698900, -89.191400')).toEqual({
      latitud: 13.6989,
      longitud: -89.1914,
    });
    expect(parsearCoordenadas('13.6989,-89.1914')).toEqual({
      latitud: 13.6989,
      longitud: -89.1914,
    });
  });

  it('prefiere las coordenadas del LUGAR sobre el centro del mapa', () => {
    // En una URL de "place" conviven las dos: `@` es dónde estaba centrado el mapa cuando el dueño
    // copió, y `!3d!4d` es la puerta del negocio. Si el dueño arrastró el mapa antes de copiar, `@`
    // apunta a otro lado — por eso `!3d!4d` gana.
    const url =
      'https://www.google.com/maps/place/Café+Aurora/@13.7000000,-89.2000000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d13.6989!4d-89.1914';
    expect(parsearCoordenadas(url)).toEqual({ latitud: 13.6989, longitud: -89.1914 });
  });

  it('usa el centro del mapa cuando no hay coordenadas de lugar', () => {
    const url = 'https://www.google.com/maps/@13.6989,-89.1914,17z';
    expect(parsearCoordenadas(url)).toEqual({ latitud: 13.6989, longitud: -89.1914 });
  });

  it('acepta los formatos con parámetro de consulta', () => {
    const casos = [
      'https://maps.google.com/?q=13.6989,-89.1914',
      'https://www.google.com/maps/search/?api=1&query=13.6989,-89.1914',
      'https://www.google.com/maps?ll=13.6989,-89.1914&z=17',
      'https://www.google.com/maps/dir/?api=1&destination=13.6989,-89.1914',
    ];
    for (const url of casos) {
      expect(parsearCoordenadas(url), url).toEqual({ latitud: 13.6989, longitud: -89.1914 });
    }
  });

  it('rechaza un enlace corto, que no lleva las coordenadas adentro', () => {
    // Este es el caso importante: es el link que da el botón Compartir del teléfono, o sea el que
    // un dueño va a pegar naturalmente. No falla el parseo por un bug — es que el dato NO ESTÁ.
    // Devolver null acá es lo que hace que resolverCoordenadas sepa que tiene que expandirlo.
    expect(parsearCoordenadas('https://maps.app.goo.gl/aBcDeFgHiJk')).toBeNull();
    expect(parsearCoordenadas('https://goo.gl/maps/aBcDeFgHiJk')).toBeNull();
  });

  it('rechaza coordenadas fuera del planeta', () => {
    expect(parsearCoordenadas('91.0, 0.5')).toBeNull();
    expect(parsearCoordenadas('-91.0, 0.5')).toBeNull();
    expect(parsearCoordenadas('13.6989, 181.0')).toBeNull();
    expect(parsearCoordenadas('13.6989, -181.0')).toBeNull();
  });

  it('acepta los bordes exactos del planeta', () => {
    // Con `<` en vez de `<=` en la validación, un local en el ecuador o en la antimeridiana
    // quedaría rechazado. Nadie tiene un local ahí, pero el borde define la intención.
    expect(parsearCoordenadas('90, 180')).toEqual({ latitud: 90, longitud: 180 });
    expect(parsearCoordenadas('-90, -180')).toEqual({ latitud: -90, longitud: -180 });
  });

  it('rechaza (0,0)', () => {
    // El "null island" del Atlántico. En la práctica siempre significa que algo se parseó mal, y
    // aceptarlo mandaría a los clientes a alta mar en vez de fallar visiblemente.
    expect(parsearCoordenadas('0,0')).toBeNull();
    expect(parsearCoordenadas('0.0, 0.0')).toBeNull();
  });

  it('rechaza texto que no lleva coordenadas', () => {
    for (const valor of ['', '   ', 'mi local', 'https://www.google.com/maps', 'Avenida 5, San Salvador']) {
      expect(parsearCoordenadas(valor), `"${valor}" no debería parsear`).toBeNull();
    }
  });

  it('no confunde un número suelto con un par', () => {
    expect(parsearCoordenadas('13.6989')).toBeNull();
  });
});

describe('esEnlaceCortoDeMapas', () => {
  it('reconoce los dos acortadores de Google', () => {
    expect(esEnlaceCortoDeMapas('https://maps.app.goo.gl/aBcDeFgHiJk')).toBe(true);
    expect(esEnlaceCortoDeMapas('https://goo.gl/maps/aBcDeFgHiJk')).toBe(true);
  });

  it('no trata una URL larga como acortador', () => {
    expect(esEnlaceCortoDeMapas('https://www.google.com/maps/@13.6989,-89.1914,17z')).toBe(false);
  });

  it('no trata como acortador algo que no es una URL', () => {
    expect(esEnlaceCortoDeMapas('13.6989, -89.1914')).toBe(false);
    expect(esEnlaceCortoDeMapas('cualquier cosa')).toBe(false);
  });

  it('no acepta un acortador ajeno a Google', () => {
    // La expansión hace una petición desde NUESTRO servidor a la URL que escribió el usuario. Si
    // acá pasara cualquier acortador, un atacante podría apuntarlo a un servicio interno de la nube
    // y nuestro servidor lo consultaría con su propia identidad de red.
    expect(esEnlaceCortoDeMapas('https://bit.ly/algo')).toBe(false);
    expect(esEnlaceCortoDeMapas('https://goo.gl.atacante.com/maps/x')).toBe(false);
  });
});
