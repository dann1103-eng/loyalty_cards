// URL pública de registro de un programa. Extraído para no duplicar esta lógica una tercera vez:
// panel/page.tsx y programas/page.tsx la armaban cada uno por su cuenta, y el cartel la necesita
// también. Pura — sin Supabase, sin `process.env` adentro (el baseUrl entra como parámetro para que
// la prueba no dependa de variables de entorno).
export function urlRegistroPrograma(
  baseUrl: string | undefined,
  comercioSlug: string,
  programaSlug: string,
  esPrincipal: boolean,
): string | null {
  const base = baseUrl?.replace(/\/$/, '');
  if (!base) return null;
  return esPrincipal ? `${base}/registro/${comercioSlug}` : `${base}/registro/${comercioSlug}/${programaSlug}`;
}
