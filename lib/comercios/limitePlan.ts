import { PLANES } from './cuentas';

// Reglas puras del límite de negocios/sucursales al cambiar de plan. Salen de `subirPlanPorElDueno`
// (planCuenta.ts) para que las use TAMBIÉN `opcionesPago.ts`, que necesita saber, ANTES de cobrar,
// con qué límite quedaría la cuenta. Dos copias de esta regla se desalinean.

export type PlanCatalogo = (typeof PLANES)[number];

// Cuánto vale un plan según el catálogo, para poder ordenarlos. Una cuenta SIN plan vale -1: desde
// ahí cualquier plan del catálogo es "subir".
export function escalonDePlan(plan: string | null): number {
  const i = PLANES.findIndex((p) => p.valor === plan);
  return i < 0 ? -1 : i;
}

// El límite que le queda a una cuenta al SUBIR a `destino`.
//
// El límite NUNCA baja al subir de plan. `limite_negocios` es un DEFAULT sugerido por plan y FM lo
// ajusta por cuenta en tratos negociados (decisión cerrada del proyecto): a un Starter con cupo 5
// negociado, aplicarle el sugerido de Growth —que es 3— le quitaría capacidad justo cuando acaba
// de aceptar pagar más. Gana el mayor.
//
// `null` EN LA CUENTA significa SIN TOPE, y sin tope le gana a cualquier número. Hasta el
// 2026-08-13 el catálogo tenía a Pro con `limiteSugerido: null`, así que el único null posible
// venía del PLAN destino y esta cuenta se resolvía sola. Ahora que Pro tiene tope de 10, el null
// sobrevive únicamente en las cuentas viejas —las que ya compraron "sin límite"— y un
// `?? 0` las mandaría a `Math.max(10, 0) = 10`: les revocaríamos lo que ya pagaron, en silencio y
// en el momento exacto en que aceptan pagar más. Por eso se chequea ANTES del Math.max.
//
// Se exige `plan !== null` para no confundir "sin tope negociado" con "cuenta recién creada a la que
// todavía nadie le asignó nada": esa segunda sí toma el sugerido del destino.
export function limiteAlSubir(
  cuenta: { plan: string | null; limite: number | null },
  destino: PlanCatalogo,
): number | null {
  const yaEstabaSinTope = cuenta.limite === null && cuenta.plan !== null;
  return yaEstabaSinTope ? null : Math.max(destino.limiteSugerido, cuenta.limite ?? 0);
}

// El límite con el que queda la cuenta al pasar a `destino`, sea subiendo o bajando. Al BAJAR (o al
// quedarse en el mismo plan) rige el sugerido del plan, igual que `resolverSolicitud`.
export function limiteResultante(
  cuenta: { plan: string | null; limite: number | null },
  destino: PlanCatalogo,
): number | null {
  const sube = escalonDePlan(destino.valor) > escalonDePlan(cuenta.plan);
  return sube ? limiteAlSubir(cuenta, destino) : destino.limiteSugerido;
}
