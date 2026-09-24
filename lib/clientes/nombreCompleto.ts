// El nombre con que el PANEL nombra a un cliente: el escáner, la lista y la ficha de Clientes, la
// tabla de clientes de Reportes (spec 2026-09-23 §3: "nombre y apellido") y la lista de clientes del
// admin. Nada más — el saludo del portal ("Hola, María") sigue con el nombre solo (decisión 7 del spec
// del 2026-09-17), y el CSV lleva el apellido en su propia columna, sin pasar por acá.
//
// Con apellido null (todo cliente registrado antes de la 0036) devuelve el nombre tal cual: muchos
// de ellos ya escribieron el nombre completo en "Nombre", y agregarle algo lo duplicaría. Un
// apellido en blanco cuenta como ausente, para no dejar un espacio colgando.
export function nombreCompleto(nombre: string, apellido: string | null): string {
  const apellidoLimpio = apellido?.trim();
  return apellidoLimpio ? `${nombre} ${apellidoLimpio}` : nombre;
}
