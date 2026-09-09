import { describe, it, expect } from 'vitest';
import { TIPOS } from './tipos';
import { etiquetaAtajoEscaner } from './etiquetaEscaner';

// EL defecto que este módulo cierra (2026-09-08): el botón que lleva al escáner decía
// "Acreditar / Canjear" (directorio de clientes) y "Acreditar / Canjear / Corregir" (ficha del
// cliente) a los OCHO tipos. El dueño de una membresía leía que iba a acreditar y a canjear, y al
// entrar al escáner encontraba un único botón "Renovar membresía" —— ni canje ni corrección,
// porque su tipo no tiene contador del que descontar.

describe('etiquetaAtajoEscaner', () => {
  it('el verbo sale de accionPrincipal: renovar en membresía, usar en cupón, registrar en descuento', () => {
    // MUTACIÓN: cambiar `VERBO[tipo.accionPrincipal]` por un 'Acreditar' fijo (que es el texto de
    // hoy) rompe estas tres.
    expect(etiquetaAtajoEscaner('membresia')).toBe('Renovar');
    expect(etiquetaAtajoEscaner('cupon')).toBe('Usar cupón');
    expect(etiquetaAtajoEscaner('descuento')).toBe('Registrar compra');
    expect(etiquetaAtajoEscaner('prepago')).toBe('Descontar / Canjear');
  });

  it('los tipos SIN contador no prometen canje ni corrección: el escáner no se los ofrece', () => {
    // MUTACIÓN: sacar el `if (tipo.contador !== 'ninguno')` y concatenar siempre reproduce el bug.
    for (const tipo of TIPOS.filter((t) => t.contador === 'ninguno')) {
      const etiqueta = etiquetaAtajoEscaner(tipo.valor, { conCorregir: true });
      expect(etiqueta, tipo.valor).not.toContain('Canjear');
      expect(etiqueta, tipo.valor).not.toContain('Corregir');
    }
  });

  it('los tipos CON contador sí ofrecen canje, y corrección solo cuando se la pide la ficha', () => {
    for (const tipo of TIPOS.filter((t) => t.contador !== 'ninguno')) {
      expect(etiquetaAtajoEscaner(tipo.valor), tipo.valor).toContain('Canjear');
      // El directorio de clientes también lo ve el CAJERO, que no corrige: no se anuncia ahí.
      expect(etiquetaAtajoEscaner(tipo.valor), tipo.valor).not.toContain('Corregir');
      expect(etiquetaAtajoEscaner(tipo.valor, { conCorregir: true }), tipo.valor).toContain('Corregir');
    }
  });

  it('los ocho tipos devuelven un texto, y ninguno queda con separadores sueltos', () => {
    for (const tipo of TIPOS) {
      for (const conCorregir of [false, true]) {
        const etiqueta = etiquetaAtajoEscaner(tipo.valor, { conCorregir });
        expect(etiqueta, tipo.valor).toBeTruthy();
        expect(etiqueta.trim(), tipo.valor).toBe(etiqueta);
        expect(etiqueta, tipo.valor).not.toMatch(/\/\s*$|^\s*\//);
      }
    }
  });

  it('un tipo desconocido cae al de puntos, nunca a un botón en blanco', () => {
    // Misma política que tipoOPuntos: una fila vieja de la BD no deja al dueño sin botón.
    expect(etiquetaAtajoEscaner('inventado')).toBe(etiquetaAtajoEscaner('puntos'));
  });
});
