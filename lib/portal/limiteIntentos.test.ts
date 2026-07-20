import { describe, it, expect, afterEach } from 'vitest';
import { createServiceClient } from '../supabase/server';
import { verificarYRegistrarIntento, LIMITE_INTENTOS, VENTANA_MINUTOS } from './limiteIntentos';

const supabase = createServiceClient();
// La columna ip es text, no inet: cualquier string sirve como marcador de prueba, y usar uno
// único por test aísla las filas de otras corridas y del tráfico real.
const ipsDePrueba: string[] = [];

function ipUnica(): string {
  const ip = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ipsDePrueba.push(ip);
  return ip;
}

afterEach(async () => {
  if (!ipsDePrueba.length) return;
  const { error } = await supabase.from('intentos_consulta_portal').delete().in('ip', ipsDePrueba);
  if (error) console.error('[test] no se pudieron borrar los intentos de prueba:', error);
  ipsDePrueba.length = 0;
});

// Siembra N intentos para una IP, todos con el mismo created_at (por defecto: ahora).
async function sembrar(ip: string, cantidad: number, created_at?: string) {
  const filas = Array.from({ length: cantidad }, () => ({ ip, ...(created_at ? { created_at } : {}) }));
  const { error } = await supabase.from('intentos_consulta_portal').insert(filas);
  if (error) throw error;
}

describe('verificarYRegistrarIntento', () => {
  it('permite el primer intento de una IP y registra la fila', async () => {
    const ip = ipUnica();

    const permitido = await verificarYRegistrarIntento(supabase, ip);

    expect(permitido).toBe(true);
    const { count } = await supabase
      .from('intentos_consulta_portal')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip);
    expect(count).toBe(1); // registró el intento aunque lo permitió
  });

  it('bloquea cuando la IP ya alcanzó el límite en la ventana, y aun así registra el intento', async () => {
    const ip = ipUnica();
    await sembrar(ip, LIMITE_INTENTOS); // exactamente el límite, todos "ahora"

    const permitido = await verificarYRegistrarIntento(supabase, ip);

    expect(permitido).toBe(false); // el intento nº (límite+1) se bloquea
    // "insert regardless of outcome": aun bloqueado, deja rastro (hostigar mantiene el bloqueo).
    const { count } = await supabase
      .from('intentos_consulta_portal')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip);
    expect(count).toBe(LIMITE_INTENTOS + 1);
  });

  it('no cuenta intentos fuera de la ventana de tiempo', async () => {
    const ip = ipUnica();
    // Muy por encima del límite, pero todos VIEJOS (fuera de la ventana): no deben contar.
    const viejo = new Date(Date.now() - (VENTANA_MINUTOS + 5) * 60_000).toISOString();
    await sembrar(ip, LIMITE_INTENTOS + 5, viejo);

    const permitido = await verificarYRegistrarIntento(supabase, ip);

    // Sin el filtro .gte('created_at', ...), estos viejos contarían y esto sería false.
    expect(permitido).toBe(true);
  });

  it('cuenta por IP, no de forma global', async () => {
    const ipLlena = ipUnica();
    await sembrar(ipLlena, LIMITE_INTENTOS);
    const ipLibre = ipUnica();

    // Sin el .eq('ip', ip), el conteo sería global y esta IP nueva heredaría el bloqueo de la otra.
    expect(await verificarYRegistrarIntento(supabase, ipLibre)).toBe(true);
  });
});
