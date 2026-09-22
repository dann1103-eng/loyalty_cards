import { describe, it, expect } from 'vitest';
import { decidirRedireccion } from './decidirRedireccion';
import type { EstadoCobranza } from '../comercios/cobranza';

// Pruebas del gate de bloqueo (spec 2026-09-21-cobranza-design.md, "Cómo se bloquea"; plan
// 2026-09-21-cobranza-y-rework-admin.md, Tarea 5).
//
// Solo `decidirRedireccion` (decidirRedireccion.ts) se corre acá: es PURA, no toca Supabase ni
// next/navigation/next/headers. El resto de este módulo —`verifyComercioAccesoSinBloqueo`,
// `verifyComercioAcceso` (verifyComercioAcceso.ts) y `verifyComercioOwnerSinBloqueo`
// (verifyComercioOwner.ts)— arma el `EstadoCobranza` leyendo `cuentas_comercio.cobranza` /
// `cobranza_desde` / `cobranza_pospuesta_hasta` (migración 0038).
//
// SIN CORRER: la migración 0038 todavía no está aplicada en Supabase (Tarea 11 del plan la aplica).
// Ese wiring se escribió y tipa, pero no se puede verificar contra la base en este worktree —no
// tiene `.env.local`— ni en producción hasta que Daniel corra la migración.
//
// MUTATION-TESTING (cada fila se corrió: romper, ver fallar con ESE test, restaurar):
//   - invertir la condición (bloquear en 'vencida' en vez de 'bloqueada': `estado.tipo !== 'vencida'`)
//       → fallan las 4 pruebas "... no bloquea" (exenta/pospuesta/al_dia/vencida no debían redirigir,
//         y con la mutación 'vencida' sí redirige) y las 2 de "bloqueada" pasan a no redirigir (esa
//         URL ahora la da 'vencida', no 'bloqueada')
//   - devolver la misma URL para 'owner' y 'cajero' (p. ej. siempre '/comercio/plan?suspendida=1')
//       → falla "bloqueada: cajero va a /comercio/suspendida" (recibe la URL del owner)

const exenta: EstadoCobranza = { tipo: 'exenta' };
const pospuesta: EstadoCobranza = { tipo: 'pospuesta', hasta: '2026-10-01' };
const alDia: EstadoCobranza = { tipo: 'al_dia', hasta: '2026-10-01', diasRestantes: 5 };
const vencida: EstadoCobranza = { tipo: 'vencida', diasVencida: 3, diasParaBloqueo: 12, esPrimerPago: false };
const bloqueada: EstadoCobranza = { tipo: 'bloqueada', diasVencida: 20 };

describe('decidirRedireccion', () => {
  it('exenta no bloquea (ni owner ni cajero)', () => {
    expect(decidirRedireccion(exenta, 'owner')).toBeNull();
    expect(decidirRedireccion(exenta, 'cajero')).toBeNull();
  });

  it('pospuesta no bloquea', () => {
    expect(decidirRedireccion(pospuesta, 'owner')).toBeNull();
    expect(decidirRedireccion(pospuesta, 'cajero')).toBeNull();
  });

  it('al_dia no bloquea', () => {
    expect(decidirRedireccion(alDia, 'owner')).toBeNull();
    expect(decidirRedireccion(alDia, 'cajero')).toBeNull();
  });

  it('vencida no bloquea todavía (tiene días de gracia)', () => {
    expect(decidirRedireccion(vencida, 'owner')).toBeNull();
    expect(decidirRedireccion(vencida, 'cajero')).toBeNull();
  });

  it('bloqueada: owner va a /comercio/plan?suspendida=1', () => {
    expect(decidirRedireccion(bloqueada, 'owner')).toBe('/comercio/plan?suspendida=1');
  });

  it('bloqueada: cajero va a /comercio/suspendida', () => {
    expect(decidirRedireccion(bloqueada, 'cajero')).toBe('/comercio/suspendida');
  });
});
