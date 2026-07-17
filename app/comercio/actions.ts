'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClienteServidor } from '@/lib/supabase/server';

export async function cerrarSesionComercio() {
  const supabase = await createClienteServidor();
  await supabase.auth.signOut();
  revalidatePath('/comercio', 'layout');
  redirect('/comercio/login');
}
