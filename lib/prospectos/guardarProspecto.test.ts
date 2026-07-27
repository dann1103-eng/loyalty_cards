import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  evaluarProspecto,
  guardarProspecto,
  LARGOS_MAXIMOS,
  type EntradaProspecto,
  type FilaProspecto,
} from './guardarProspecto';

// Envío mínimo VÁLIDO. Cada prueba cambia solo el campo que le interesa, para que un fallo señale
// esa regla y no un descuido del resto del objeto.
function envio(cambios: Partial<EntradaProspecto> = {}): EntradaProspecto {
  return {
    nombre: 'Ana Rivera',
    negocio: 'Café Volcán',
    correo: 'ana@cafevolcan.com',
    telefono: '',
    mensaje: '',
    origen: '',
    trampa: '',
    ...cambios,
  };
}

// Cliente de Supabase de mentira. Sin red: lo que importa de guardarProspecto es CUÁNDO inserta y
// QUÉ inserta, y una prueba contra la BD real dejaría filas de prueba en la lista de clientes
// potenciales del dueño (la migración 0014 dice explícitamente que de ahí no se borra nada).
function clienteFalso(errorInsert: { message: string } | null = null) {
  const insertadas: FilaProspecto[] = [];
  const tablas: string[] = [];
  const cliente = {
    from(tabla: string) {
      tablas.push(tabla);
      return {
        insert(fila: FilaProspecto) {
          insertadas.push(fila);
          return Promise.resolve({ error: errorInsert });
        },
      };
    },
  };
  return { cliente: cliente as unknown as SupabaseClient<Database>, insertadas, tablas };
}

describe('evaluarProspecto — obligatorios', () => {
  it('acepta un envío con nombre, negocio y correo', () => {
    const resultado = evaluarProspecto(envio());

    expect(resultado.estado).toBe('valido');
    if (resultado.estado !== 'valido') return;
    expect(resultado.fila).toEqual({
      nombre: 'Ana Rivera',
      negocio: 'Café Volcán',
      correo: 'ana@cafevolcan.com',
      telefono: null,
      mensaje: null,
      origen: null,
    });
  });

  it('rechaza un envío sin nombre', () => {
    const resultado = evaluarProspecto(envio({ nombre: '' }));

    expect(resultado).toEqual({ estado: 'invalido', error: 'Escribí tu nombre.' });
  });

  it('trata un nombre de puros espacios como vacío', () => {
    // Sin el .trim() previo, '   ' pasaría la validación y la fila quedaría con un nombre en blanco.
    const resultado = evaluarProspecto(envio({ nombre: '   ' }));

    expect(resultado).toEqual({ estado: 'invalido', error: 'Escribí tu nombre.' });
  });

  it('rechaza un envío sin negocio', () => {
    const resultado = evaluarProspecto(envio({ negocio: '  ' }));

    expect(resultado).toEqual({ estado: 'invalido', error: 'Escribí el nombre de tu negocio.' });
  });

  it('recorta los espacios de lo que se guarda', () => {
    const resultado = evaluarProspecto(
      envio({ nombre: '  Ana Rivera  ', negocio: '  Café Volcán ', correo: '  ana@cafevolcan.com  ' }),
    );

    expect(resultado.estado).toBe('valido');
    if (resultado.estado !== 'valido') return;
    expect(resultado.fila.nombre).toBe('Ana Rivera');
    expect(resultado.fila.negocio).toBe('Café Volcán');
    expect(resultado.fila.correo).toBe('ana@cafevolcan.com');
  });
});

describe('evaluarProspecto — al menos una forma de contacto', () => {
  it('acepta solo con correo', () => {
    const resultado = evaluarProspecto(envio({ correo: 'ana@cafevolcan.com', telefono: '' }));

    expect(resultado.estado).toBe('valido');
  });

  it('acepta solo con teléfono', () => {
    const resultado = evaluarProspecto(envio({ correo: '', telefono: '7777 1234' }));

    expect(resultado.estado).toBe('valido');
    if (resultado.estado !== 'valido') return;
    // Se guarda TAL CUAL lo escribió: no es llave de identidad como clientes.telefono, así que no
    // se normaliza a +503.
    expect(resultado.fila.telefono).toBe('7777 1234');
    expect(resultado.fila.correo).toBeNull();
  });

  it('rechaza un envío sin correo ni teléfono', () => {
    const resultado = evaluarProspecto(envio({ correo: '', telefono: '' }));

    expect(resultado).toEqual({
      estado: 'invalido',
      error: 'Dejanos un correo o un teléfono para poder responderte.',
    });
  });

  it('rechaza cuando los dos contactos son solo espacios', () => {
    // El caso que se cuela si se valida `entrada.correo` en crudo en vez del valor ya recortado:
    // ' ' es truthy y pasaría como "sí dejó correo".
    const resultado = evaluarProspecto(envio({ correo: '   ', telefono: ' ' }));

    expect(resultado).toEqual({
      estado: 'invalido',
      error: 'Dejanos un correo o un teléfono para poder responderte.',
    });
  });

  it('rechaza un correo sin forma de correo', () => {
    for (const malo of ['ana', 'ana@gmail', 'ana gmail.com', '@gmail.com', 'ana@.com']) {
      expect(evaluarProspecto(envio({ correo: malo })), malo).toEqual({
        estado: 'invalido',
        error: 'Ese correo no parece válido. Revisalo, por favor.',
      });
    }
  });

  it('rechaza un teléfono con menos de 8 dígitos', () => {
    const resultado = evaluarProspecto(envio({ correo: '', telefono: '7777' }));

    expect(resultado).toEqual({
      estado: 'invalido',
      error: 'Ese teléfono no parece válido. Escribilo con sus 8 dígitos.',
    });
  });

  it('acepta un teléfono escrito con guiones, espacios o código de país', () => {
    for (const bueno of ['7777-1234', '7777 1234', '+503 7777 1234', '(503) 2222-3333']) {
      expect(evaluarProspecto(envio({ correo: '', telefono: bueno })).estado, bueno).toBe('valido');
    }
  });
});

describe('evaluarProspecto — el campo trampa', () => {
  it('trata como trampa un envío con el campo oculto lleno', () => {
    const resultado = evaluarProspecto(envio({ trampa: 'http://spam.example' }));

    expect(resultado).toEqual({ estado: 'trampa' });
  });

  it('la trampa gana sobre cualquier otro error de validación', () => {
    // Si la trampa se revisara DESPUÉS, este envío respondería "Escribí tu nombre." y le estaría
    // diciendo al bot exactamente qué corregir para pasar.
    const resultado = evaluarProspecto(envio({ nombre: '', correo: '', telefono: '', trampa: 'x' }));

    expect(resultado).toEqual({ estado: 'trampa' });
  });

  it('un campo trampa vacío o con espacios NO bloquea a una persona', () => {
    // Algunos navegadores mandan el campo con espacios; tratarlos como trampa haría desaparecer
    // envíos legítimos sin que nadie se entere (responden "éxito" y no se guarda nada).
    expect(evaluarProspecto(envio({ trampa: '' })).estado).toBe('valido');
    expect(evaluarProspecto(envio({ trampa: '   ' })).estado).toBe('valido');
  });
});

describe('evaluarProspecto — topes de largo', () => {
  it('rechaza un nombre más largo que el tope', () => {
    const resultado = evaluarProspecto(envio({ nombre: 'a'.repeat(LARGOS_MAXIMOS.nombre + 1) }));

    expect(resultado).toEqual({ estado: 'invalido', error: 'Ese nombre es demasiado largo.' });
  });

  it('acepta un nombre exactamente del largo del tope', () => {
    const resultado = evaluarProspecto(envio({ nombre: 'a'.repeat(LARGOS_MAXIMOS.nombre) }));

    expect(resultado.estado).toBe('valido');
  });

  it('rechaza un mensaje más largo que el tope', () => {
    const resultado = evaluarProspecto(envio({ mensaje: 'a'.repeat(LARGOS_MAXIMOS.mensaje + 1) }));

    expect(resultado).toEqual({
      estado: 'invalido',
      error: 'El mensaje es muy largo. Contanos lo esencial.',
    });
  });

  it('RECORTA el origen en vez de rechazar el envío', () => {
    // El origen lo pone la página, no la persona: rechazar por él sería perder un cliente
    // potencial por un parámetro de campaña mal armado.
    const resultado = evaluarProspecto(envio({ origen: 'x'.repeat(LARGOS_MAXIMOS.origen + 40) }));

    expect(resultado.estado).toBe('valido');
    if (resultado.estado !== 'valido') return;
    expect(resultado.fila.origen).toBe('x'.repeat(LARGOS_MAXIMOS.origen));
  });
});

describe('guardarProspecto', () => {
  it('inserta en prospectos exactamente la fila evaluada', async () => {
    const { cliente, insertadas, tablas } = clienteFalso();

    const resultado = await guardarProspecto(
      cliente,
      envio({ telefono: '7777 1234', mensaje: 'Tengo tres sucursales', origen: 'instagram' }),
    );

    expect(resultado).toEqual({ ok: true, guardado: true });
    expect(tablas).toEqual(['prospectos']);
    expect(insertadas).toEqual([
      {
        nombre: 'Ana Rivera',
        negocio: 'Café Volcán',
        correo: 'ana@cafevolcan.com',
        telefono: '7777 1234',
        mensaje: 'Tengo tres sucursales',
        origen: 'instagram',
      },
    ]);
  });

  it('con la trampa llena responde éxito pero NO escribe nada', async () => {
    const { cliente, insertadas } = clienteFalso();

    const resultado = await guardarProspecto(cliente, envio({ trampa: 'spam' }));

    // Éxito hacia afuera (el bot no aprende que lo detectamos)…
    expect(resultado).toEqual({ ok: true, guardado: false });
    // …y ninguna fila en la lista que después alguien tiene que leer a mano.
    expect(insertadas).toEqual([]);
  });

  it('con datos inválidos no escribe nada y devuelve el error de validación', async () => {
    const { cliente, insertadas } = clienteFalso();

    const resultado = await guardarProspecto(cliente, envio({ correo: '', telefono: '' }));

    expect(resultado).toEqual({
      ok: false,
      error: 'Dejanos un correo o un teléfono para poder responderte.',
    });
    expect(insertadas).toEqual([]);
  });

  it('si la BD falla, devuelve un error para la persona y deja rastro en el log', async () => {
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { cliente } = clienteFalso({ message: 'connection reset' });

    const resultado = await guardarProspecto(cliente, envio());

    expect(resultado).toEqual({
      ok: false,
      error: 'No pudimos guardar tus datos. Probá de nuevo en un momento.',
    });
    // Un fallo sistemático de inserts sería perder clientes potenciales en silencio.
    expect(registro).toHaveBeenCalled();
    registro.mockRestore();
  });
});
