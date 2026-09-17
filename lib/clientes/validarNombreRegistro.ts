// Nombre y apellido del registro público (/api/registro), validados en un solo lugar y con el MISMO
// criterio para los dos (spec 2026-09-17, "El apellido"):
//   - no es texto o viene vacío → 'Faltan datos' (lo mismo que ya respondía la ruta con el nombre);
//   - recortado queda vacío o pasa de 120 → 'Nombre inválido' / 'Apellido inválido'.
//
// Faltar gana sobre ser inválido, y el nombre se revisa antes que el apellido (el orden del
// formulario): un cliente con los dos mal lee primero el que tiene arriba.
//
// Vivía dentro de la ruta, sin prueba. Salió a una función pura porque el tope ya no es solo una
// regla de la pantalla: `clientes.apellido` tiene un CHECK (0036) de `btrim <> ''` y hasta 120, y un
// apellido que pasara de acá sin entrar en la columna tumbaría el alta entera con 23514 en vez de
// devolverle al cliente un 400 que pueda leer.
//
// Los dos devueltos ya van RECORTADOS: es lo que `registrarCliente` espera recibir.
const LARGO_MAXIMO = 120;

export type ResultadoNombreRegistro =
  | { ok: true; nombre: string; apellido: string }
  | { ok: false; error: string };

export function validarNombreRegistro(datos: {
  nombre: unknown;
  apellido: unknown;
}): ResultadoNombreRegistro {
  const { nombre, apellido } = datos;

  if (typeof nombre !== 'string' || !nombre || typeof apellido !== 'string' || !apellido) {
    return { ok: false, error: 'Faltan datos' };
  }

  const nombreLimpio = nombre.trim();
  if (nombreLimpio.length === 0 || nombreLimpio.length > LARGO_MAXIMO) {
    return { ok: false, error: 'Nombre inválido' };
  }

  const apellidoLimpio = apellido.trim();
  if (apellidoLimpio.length === 0 || apellidoLimpio.length > LARGO_MAXIMO) {
    return { ok: false, error: 'Apellido inválido' };
  }

  return { ok: true, nombre: nombreLimpio, apellido: apellidoLimpio };
}
