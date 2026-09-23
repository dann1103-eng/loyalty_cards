import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { aplicaReglaDeMonto, formatearCentavos } from '../tarjetas/tipos';

// La regla de monto obligatorio / mínimo de compra del comercio (columnas exigir_monto_compra y
// monto_minimo_compra_centavos de comercios, migración 0039). Nace del primer onboarding con
// clientes reales (2026-09-22): un comercio quiere poder exigir el monto de la compra y fijar un
// mínimo para sumar sellos/puntos ("solo sello consumos de $10 en adelante"), en vez de sumar con
// cualquier compra o ninguna.
// Spec: docs/superpowers/specs/2026-09-23-onboarding-manifest-monto-resena-design.md, sección 2,
// "La regla, en una función pura".
//
// Este módulo es la única fuente de la regla: la aplican los DOS caminos que acreditan puntos o
// sellos (el escáner y "Agregar cliente"), y ninguno la reimplementa.

export type ResultadoMontoAcreditacion =
  | { ok: true }
  | { ok: false; error: string; bloqueoLimite?: true };

// En orden — el orden importa, no son dos chequeos independientes:
//
// 1. Si el comercio exige el monto (checkbox, o un mínimo configurado — un mínimo sin exigir es una
//    combinación que la BD prohíbe, pero esta función no depende de eso) y no hay un monto positivo,
//    falta el dato. NO es `bloqueoLimite`: se resuelve TECLEANDO el monto, no autorizando — no hay
//    nada que el dueño pueda autorizar sobre una compra que nadie describió. $0.00 tampoco cuenta
//    como compra: por eso `!(montoCentavos > 0)` y no solo `=== null`.
// 2. Con el monto en mano, si hay un mínimo y no llega (y nadie autorizó), se rechaza CON
//    `bloqueoLimite: true`: así el escáner y "Agregar cliente" reusan el mismo panel de autorización
//    del dueño que ya existe para las perillas antifraude (decisión 6 de la spec).
// 3. Si no, la compra pasa.
export function validarMontoAcreditacion({
  exigir,
  minimoCentavos,
  montoCentavos,
  autorizado,
}: {
  exigir: boolean;
  minimoCentavos: number | null;
  montoCentavos: number | null;
  autorizado: boolean;
}): ResultadoMontoAcreditacion {
  // `!(montoCentavos > 0)` y no `montoCentavos <= 0`: son distintas para NaN (`NaN <= 0` es false,
  // así que ese chequeo dejaba pasar un NaN como si fuera positivo). La Tarea 4
  // (controlesDesdeFormulario, lib/comercio/controlesAcreditacion.ts) usa NaN como marca de "typo"
  // al parsear un monto tecleado — este chequeo tiene que atraparlo igual que un monto faltante, no
  // dejarlo colarse como válido.
  if ((exigir || minimoCentavos !== null) && (montoCentavos === null || !(montoCentavos > 0))) {
    // El mismo texto que ya usa el escáner (app/comercio/(protegido)/escanear/actions.ts) para el
    // monto obligatorio de cashback/gift card/descuento: un solo mensaje para "falta el monto",
    // venga de donde venga la exigencia.
    return { ok: false, error: 'Escribí el monto de la compra (por ejemplo 19.99).' };
  }

  // montoCentavos ya no puede ser null acá: si minimoCentavos !== null, el `if` de arriba ya
  // rechazó (y salió) un montoCentavos null. El chequeo explícito es para el typechecker, no
  // lógica nueva — se prefiere a un `!` de aserción.
  if (minimoCentavos !== null && montoCentavos !== null && montoCentavos < minimoCentavos && !autorizado) {
    return {
      ok: false,
      error: `La compra mínima para sumar es ${formatearCentavos(minimoCentavos)}.`,
      bloqueoLimite: true,
    };
  }

  return { ok: true };
}

// ¿Vale la pena mostrarle esta configuración al dueño en Reglas? Sí si ALGÚN programa del comercio
// —el principal o uno secundario— es de puntos o sellos. Sin filtrar por `activo` a propósito:
// `obtenerPrograma` (lib/comercio/programas.ts) no filtra por activo, así que las tarjetas de un
// programa desactivado se siguen escaneando y acreditando, y la regla les sigue aplicando. La
// comparten la página de Reglas y su prueba (Tarea 4): ambas llaman a esta misma función en vez de
// repetir el filtro.
//
// La garantía de que esta función VE los desactivados vive en el LLAMADOR, no acá: tiene que armar
// `programas` con `listarProgramas(supabase, comercioId, { soloActivos: false })` — el default de
// `listarProgramas` (lib/comercio/programas.ts) filtra `activo = true` (línea ~203), así que un
// llamador que use el default le esconde a esta función justo los programas que le importan.
export function ofreceReglaDeMonto(programas: { tipoTarjeta: string }[]): boolean {
  return programas.some((p) => aplicaReglaDeMonto(p.tipoTarjeta));
}

export interface ReglaDeMonto {
  exigir: boolean;
  minimoCentavos: number | null;
}

// Lee la regla configurada del comercio. `null` si la lectura falla o el comercio no existe: quien
// llama a esto en el camino de acreditar la trata como una falla que se resuelve hacia lo
// restrictivo ("No se pudo verificar la regla de monto. Probá de nuevo."), no como "sin regla".
export async function leerReglaDeMonto(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<ReglaDeMonto | null> {
  const { data, error } = await supabase
    .from('comercios')
    // Un ÚNICO literal, sin concatenar — mismo motivo que leerControles en controlesAcreditacion.ts:
    // supabase-js infiere el tipo del resultado parseando esta cadena en tiempo de compilación, y
    // una concatenación la vuelve `string` genérico y pierde todo el tipado.
    .select('exigir_monto_compra, monto_minimo_compra_centavos')
    .eq('id', comercioId)
    .maybeSingle();

  if (error || !data) {
    console.error('[monto] no se pudo leer la regla de monto del comercio:', error);
    return null;
  }

  return {
    exigir: data.exigir_monto_compra,
    minimoCentavos: data.monto_minimo_compra_centavos,
  };
}
