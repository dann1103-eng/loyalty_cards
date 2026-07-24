'use server';

import { fijarComercioActivo } from '@/lib/comercio/fijarComercioActivo';

// Fija el "comercio activo" a partir de la elección del dueño en /comercio/elegir. El comercioId
// llega ligado por bind() en el <form> (input del cliente); fijarComercioActivo lo revalida SIEMPRE
// contra la lista real de membresías antes de escribir la cookie (spec §4.4), redirige al panel, y
// mantiene redirect()/getClaims() fuera de try/catch.
export async function elegirComercio(comercioId: string) {
  await fijarComercioActivo(comercioId);
}
