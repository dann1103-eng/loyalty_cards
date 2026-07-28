// Zonas horarias que un comercio puede elegir. Define el corte del día del tope diario de
// acreditaciones y el de reporte_tendencia.
//
// ESTA LISTA ES ESPEJO DEL CHECK de `comercios.zona_horaria` en la migración 0015. Las dos se
// mueven JUNTAS: si acá aparece una zona que el CHECK no acepta, la UI se la ofrece al dueño y la
// BD la rechaza con 23514 ("No se pudo guardar") sin que él entienda por qué. Es el mismo
// acoplamiento que NIVELES_DIFUMINADO / difuminado_franja (0007) y TIPOS_TARJETA / tipo_tarjeta (0005).
//
// Por qué lista cerrada y no texto libre: un nombre de zona inválido hace que `at time zone` lance
// 22023 DENTRO de acreditar_atomico, o sea que un typo en un campo de configuración dejaría al
// comercio SIN PODER SELLAR. El CHECK es el que impide que eso llegue a producción.

export interface ZonaHoraria {
  valor: string;
  etiqueta: string;
}

// Ordenadas por cercanía comercial: Centroamérica primero (el mercado de hoy), después el resto de
// Latinoamérica, después EE.UU. y España (donde viven los comercios de la diáspora).
export const ZONAS_HORARIAS: readonly ZonaHoraria[] = [
  { valor: 'America/El_Salvador', etiqueta: 'El Salvador' },
  { valor: 'America/Guatemala', etiqueta: 'Guatemala' },
  { valor: 'America/Tegucigalpa', etiqueta: 'Honduras' },
  { valor: 'America/Managua', etiqueta: 'Nicaragua' },
  { valor: 'America/Costa_Rica', etiqueta: 'Costa Rica' },
  { valor: 'America/Panama', etiqueta: 'Panamá' },
  { valor: 'America/Belize', etiqueta: 'Belice' },
  { valor: 'America/Mexico_City', etiqueta: 'México (Ciudad de México)' },
  { valor: 'America/Bogota', etiqueta: 'Colombia' },
  { valor: 'America/Lima', etiqueta: 'Perú' },
  { valor: 'America/Guayaquil', etiqueta: 'Ecuador' },
  { valor: 'America/Santo_Domingo', etiqueta: 'República Dominicana' },
  { valor: 'America/Caracas', etiqueta: 'Venezuela' },
  { valor: 'America/Santiago', etiqueta: 'Chile' },
  { valor: 'America/Asuncion', etiqueta: 'Paraguay' },
  { valor: 'America/Montevideo', etiqueta: 'Uruguay' },
  { valor: 'America/Argentina/Buenos_Aires', etiqueta: 'Argentina' },
  { valor: 'America/Sao_Paulo', etiqueta: 'Brasil (São Paulo)' },
  { valor: 'America/New_York', etiqueta: 'EE.UU. — Este' },
  { valor: 'America/Chicago', etiqueta: 'EE.UU. — Centro' },
  { valor: 'America/Denver', etiqueta: 'EE.UU. — Montaña' },
  { valor: 'America/Los_Angeles', etiqueta: 'EE.UU. — Pacífico' },
  { valor: 'Europe/Madrid', etiqueta: 'España' },
] as const;

export const ZONA_HORARIA_DEFAULT = 'America/El_Salvador';

export function esZonaHorariaValida(valor: string): boolean {
  return ZONAS_HORARIAS.some((z) => z.valor === valor);
}

export function etiquetaZonaHoraria(valor: string): string {
  return ZONAS_HORARIAS.find((z) => z.valor === valor)?.etiqueta ?? valor;
}
