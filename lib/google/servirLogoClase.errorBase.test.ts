import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { servirLogoClase } from './servirLogoClase';

// Un error de Supabase al leer la marca NO es "no existe": es un problema pasajero, como el bucket que
// no responde, y la ruta contesta 502. Con un 404 el patch de la clase se rechazaría igual, pero el
// código diría que el comercio o el programa no existen — y 404 queda reservado para eso (sin comercio,
// sin logo, programa ajeno).
//
// Archivo APARTE porque hace falta mockear createServiceClient: contra la base real no hay forma de
// forzar un error de lectura (mismo criterio que altaPorTelefono.reglaIlegible.test.ts). Las rutas
// con la base real se prueban en app/api/comercios/[comercioId]/logo.png/route.test.ts.
//
// MUTACIÓN corrida el 2026-09-23 (restaurada y comparada con el índice de git): ignorar el `error` de
// las dos consultas (sin el `if (consultaComercio.error || consultaPrograma.error)`) → FALLAN "error al
// leer el COMERCIO → 502…" y "error al leer el PROGRAMA → 502…", las dos con `expected 404 to be 502`.

type Resultado = { data: unknown; error: { message: string } | null };

interface ConsultaFalsa {
  select: () => ConsultaFalsa;
  eq: () => ConsultaFalsa;
  maybeSingle: () => Promise<Resultado>;
}

function consulta(resultado: Resultado): ConsultaFalsa {
  const q: ConsultaFalsa = { select: () => q, eq: () => q, maybeSingle: async () => resultado };
  return q;
}

const respuestas: Record<string, Resultado> = {};
vi.mock('../supabase/server', () => ({
  createServiceClient: () => ({ from: (tabla: string) => consulta(respuestas[tabla]) }),
}));

// Si la ruta llegara a bajar el logo, sería un error de la prueba: con la marca ilegible no hay qué bajar.
const bajarLogoMock = vi.fn();
vi.mock('./logoRemoto', () => ({
  bajarLogo: (...args: unknown[]) => bajarLogoMock(...args),
}));

const COMERCIO = {
  color_fondo: 'rgb(10, 20, 30)',
  color_texto: null,
  color_label: null,
  logo_url: 'https://ejemplo.com/logo.png',
  hero_url: null,
  strip_url: null,
  sello_icono_url: null,
  difuminado_franja: 'medio',
  encuadre_franja: null,
  foco_franja_x: null,
  foco_franja_y: null,
  zoom_franja: null,
};

const componer = vi.fn();

beforeEach(() => {
  bajarLogoMock.mockReset();
  componer.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const tabla of Object.keys(respuestas)) delete respuestas[tabla];
});

function pedir(programaId?: string) {
  const url = `http://localhost/api/comercios/com-1/logo.png${programaId ? `?programa=${programaId}` : ''}`;
  return servirLogoClase(new NextRequest(url), 'com-1', componer);
}

describe('servirLogoClase — errores de la base', () => {
  it('error al leer el COMERCIO → 502 (pasajero), no 404', async () => {
    respuestas.comercios = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const res = await pedir();
    expect(res.status).toBe(502);
    expect(bajarLogoMock).not.toHaveBeenCalled();
  });

  it('error al leer el PROGRAMA → 502 (pasajero), no 404 como si fuera ajeno', async () => {
    respuestas.comercios = { data: COMERCIO, error: null };
    respuestas.programas_tarjeta = { data: null, error: { message: 'canceling statement due to statement timeout' } };
    const res = await pedir('prog-1');
    expect(res.status).toBe(502);
    expect(bajarLogoMock).not.toHaveBeenCalled();
  });

  // El otro lado, con el mismo mock: sin error y sin fila sigue siendo 404. Así las dos de arriba no
  // pasan por un mock que devuelva 502 para todo.
  it('sin error y sin fila (el comercio no existe) → 404', async () => {
    respuestas.comercios = { data: null, error: null };
    expect((await pedir()).status).toBe(404);
  });

  it('sin error y sin programa (ajeno o inexistente) → 404', async () => {
    respuestas.comercios = { data: COMERCIO, error: null };
    respuestas.programas_tarjeta = { data: null, error: null };
    expect((await pedir('prog-ajeno')).status).toBe(404);
  });
});
