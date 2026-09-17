// El filtro del buscador de /comercio/clientes. Vivía en línea dentro de la página y salió acá, sin
// cambiarle la semántica, cuando el apellido (0036) pasó a ser parte de lo que se busca: sin una
// función pura no había forma de probar que buscar "Rivera" encuentra a María Rivera.
//
// La semántica de siempre: búsqueda recortada; vacía deja pasar a todos; si no, subcadena sin
// distinguir mayúsculas sobre "nombre apellido teléfono".
export interface ClienteBuscable {
  nombre: string | null;
  apellido: string | null;
  telefono: string | null;
}

export function coincideBusqueda(cliente: ClienteBuscable | null, q: string): boolean {
  const busqueda = q.trim();
  if (!busqueda) return true;

  // El apellido entra SOLO si existe. Antes de la 0036 el texto era "nombre teléfono" con un único
  // espacio; con un apellido null metido como '' quedaría un espacio doble, y "López +503…" dejaría
  // de encontrar a un cliente que hoy sí encuentra.
  const partes = [cliente?.nombre ?? '', ...(cliente?.apellido ? [cliente.apellido] : []), cliente?.telefono ?? ''];
  return partes.join(' ').toLowerCase().includes(busqueda.toLowerCase());
}
