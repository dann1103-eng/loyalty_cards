/**
 * Lee una variable de entorno requerida y lanza un error claro y NOMBRADO si falta o está
 * vacía, en vez de fallar más adelante de forma críptica (p. ej. `Buffer.from(undefined)`).
 *
 * Por qué existe: al desplegar (Tarea 12) se copian ~11 variables a Vercel a mano — el momento
 * de máximo riesgo de dedo. Si falta una, este helper dice exactamente cuál, en vez de un 500
 * genérico enterrado en los logs.
 */
export function requireEnv(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) {
    throw new Error(`Falta la variable de entorno ${nombre}`);
  }
  return valor;
}
