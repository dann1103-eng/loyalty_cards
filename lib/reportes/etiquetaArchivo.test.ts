import { describe, it, expect } from 'vitest';
import { etiquetaDeArchivo } from './etiquetaArchivo';

// El nombre del comercio dentro del nombre de un archivo descargado (el Excel de Reportes y la lista de
// clientes). Lo que le importa al dueño: que "Panadería La Peña" se lea "panaderia-la-pena" y no
// "panader-a-la-pe-a"; y a la ruta, que lo que sale entre en una cabecera HTTP sin romperla.
//
// MUTATION-TESTING (corridas el 2026-09-24, una por vez y restauradas; con el mensaje que se vio caer):
// - Sin `normalize('NFD')`: caen 7, entre ellas "Panadería La Peña" con `expected 'panader-a-la-pe-a' to
//   be 'panaderia-la-pena'` y "Ñandú" con `expected 'and' to be 'nandu'`. ("Pen" + U+0303 + "a", ya
//   descompuesto, sigue verde: sus marcas las tira el replace de todos modos.) Caen también 6 de las
//   rutas (ver sus route.test.ts), por ejemplo `expected 'attachment; filename="reportes-caf-ex…' to be
//   'attachment; filename="reportes-cafe-e…'`.
// - Sin el respaldo (`return etiqueta;`): caen las 5 de "no queda nada" con `expected '' to be
//   'comercio'`, y la de la cabecera con `☕ ☕: expected '' to match /^[a-z0-9]+(?:-[a-z0-9]+)*$/`.
// Extras:
// - Con NFD pero sin tirar las marcas: caen 5, "Panadería La Peña" con `expected 'panaderi-a-la-pen-a'
//   to be 'panaderia-la-pena'` (cada marca suelta se vuelve un guion).
// - Sin el corte de 60: caen 3, la de la cabecera con `…: expected 200 to be less than or equal to 60`.
// - Sin quitar el guion que deja el corte: cae "si el corte cae en un guion…" con `expected
//   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…' to be 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…'` (las 59
//   letras con el guion al final, contra las 59 solas).

// ASCII puro: palabras de minúsculas y dígitos, unidas por UN guion, sin guion en los bordes.
const FORMA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('etiquetaDeArchivo', () => {
  it.each([
    ['Panadería La Peña', 'panaderia-la-pena'],
    ['Ñandú', 'nandu'],
    ['Café Excel', 'cafe-excel'],
    ['ÁÉÍÓÚ Ü ñ', 'aeiou-u-n'],
    // Ya descompuesto (la "ñ" como "n" + U+0303): da lo mismo que la precompuesta.
    ['Pen\u0303a', 'pena'],
    // Una letra que NFD no descompone cae al guion, como cualquier símbolo.
    ['Straße', 'stra-e'],
  ])('los acentos y la ñ se quedan con su letra: %j → %j', (nombre, esperado) => {
    expect(etiquetaDeArchivo(nombre)).toBe(esperado);
  });

  it.each([
    // Comillas, barra y un CRLF: son los que parten el Content-Disposition.
    ['Café "El Sol" / Centro\r\nX', 'cafe-el-sol-centro-x'],
    ['☕ Café ☕', 'cafe'],
    ["  O'Brien's  --  Bar  ", 'o-brien-s-bar'],
  ])('comillas, saltos de línea, emoji y espacios se vuelven UN guion, nunca en los bordes: %j → %j', (nombre, esperado) => {
    expect(etiquetaDeArchivo(nombre)).toBe(esperado);
  });

  it.each([['☕ ☕'], [''], ['   '], ['"\r\n'], ['¿¡!?']])(
    'un nombre del que no queda nada (%j) da el respaldo "comercio", nunca una etiqueta vacía',
    (nombre) => {
      expect(etiquetaDeArchivo(nombre)).toBe('comercio');
    },
  );

  it('un nombre largo se corta en 60 caracteres', () => {
    expect(
      etiquetaDeArchivo('Pastelería y Cafetería Doña Ñeca de los Ángeles, Sucursal Metrocentro San Salvador'),
    ).toBe('pasteleria-y-cafeteria-dona-neca-de-los-angeles-sucursal-met');
  });

  it('si el corte cae en un guion, no queda colgando', () => {
    // 59 letras, un espacio y otra letra: la etiqueta entera tendría 61 y el carácter 60 es el guion.
    expect(etiquetaDeArchivo(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
  });

  it('lo que sale es ASCII puro y entra en una cabecera Content-Disposition sin romperla', () => {
    const hostiles = [
      'Panadería La Peña',
      'Café "El Sol" / Centro\r\nX',
      '☕ ☕',
      '\u0000\u001f\u007f',
      'a"; filename*=UTF-8\'\'malo.exe',
      '日本の店',
      `${'Ñ'.repeat(200)}`,
    ];
    for (const nombre of hostiles) {
      const etiqueta = etiquetaDeArchivo(nombre);
      expect(etiqueta, nombre).toMatch(FORMA);
      expect(etiqueta.length, nombre).toBeLessThanOrEqual(60);
      // Headers lanza con un carácter fuera de Latin-1 o un salto de línea: es lo que hacía caer la ruta.
      expect(
        () => new Headers({ 'Content-Disposition': `attachment; filename="reportes-${etiqueta}.xlsx"` }),
        nombre,
      ).not.toThrow();
    }
  });
});
