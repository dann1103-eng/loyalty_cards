import type { DatosComercio } from '@/lib/comercios/guardarComercio';

// Parseo del FormData de FormularioComercio — compartido por accionActualizarComercio
// (comercios/actions.ts) y accionCrearComercioDeCuenta (cuentas/actions.ts, Tarea 7): las dos
// altas/ediciones usan el MISMO formulario, así que el parseo no puede vivir DUPLICADO en los dos
// archivos de acciones sin arriesgar que diverjan.
//
// Archivo APARTE, no exportado desde comercios/actions.ts: ese archivo lleva 'use server' arriba, y
// el compilador de Next exige que TODO lo que exporta un archivo 'use server' sea una Server Action
// asíncrona — una función síncrona exportada ahí (como esta) rompe el build entero con "Server
// Actions must be async functions.", no solo esta pantalla. Se encontró recorriendo el navegador
// de verdad (2026-09-22): ni tsc ni eslint lo atrapan, es una regla del compilador de Next.
function textoONull(valor: FormDataEntryValue | null): string | null {
  const s = String(valor ?? '').trim();
  return s === '' ? null : s;
}

export function leerDatos(formData: FormData): DatosComercio {
  return {
    nombre: String(formData.get('nombre') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim(),
    color_fondo: String(formData.get('color_fondo') ?? '').trim(),
    color_texto: String(formData.get('color_texto') ?? '').trim(),
    color_label: String(formData.get('color_label') ?? '').trim(),
    logo_url: textoONull(formData.get('logo_url')),
    strip_url: textoONull(formData.get('strip_url')),
    hero_url: textoONull(formData.get('hero_url')),
    tipo_tarjeta: String(formData.get('tipo_tarjeta') ?? 'puntos'),
    cuenta_id: String(formData.get('cuenta_id') ?? ''),
  };
}
