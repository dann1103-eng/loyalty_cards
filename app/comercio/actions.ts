'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';
import { fijarComercioActivo } from '@/lib/comercio/fijarComercioActivo';

export async function cerrarSesionComercio() {
  const supabase = await createClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/login');
}

// Cambia el "comercio activo" desde el selector del header (SelectorComercio). Mismo camino que
// elegirComercio: fijarComercioActivo revalida el nuevoId (input del cliente) contra las membresías
// reales antes de escribir la cookie (spec §4.4) y redirige al panel.
export async function cambiarComercioActivo(comercioId: string) {
  await fijarComercioActivo(comercioId);
}
