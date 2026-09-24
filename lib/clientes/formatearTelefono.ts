import { PAISES } from './paises';

// Un teléfono CANÓNICO (como lo guarda normalizarTelefono: `+<código de país><dígitos>`), partido para
// LEERLO: "+50377771234" → "+503 7777 1234". Solo para mostrar: se guarda, se busca y se exporta el
// canónico (el Excel y el CSV lo necesitan entero para que no se reinterprete).
//
// Nace con la tabla de clientes de Reportes (spec 2026-09-23 §3: "debajo, el teléfono formateado"),
// donde doce dígitos seguidos en una columna angosta no se leen de un vistazo.
//
// Los grupos salen del `ejemplo` de cada país en paises.ts ("7777 1234" → 4 y 4; "612 34 56 78" → 3,
// 2, 2 y 2), no de una tabla escrita acá: agregar un país es una línea, y ya trae cómo se parte.
//
// Lo que no se puede partir con CERTEZA sale tal cual, porque un número mal partido se lee como otro:
//   - lo que no es canónico (espacios, guiones, sin '+': datos viejos o de prueba);
//   - un código que no está en la lista, o un largo que su país no acepta;
//   - un largo válido que el ejemplo no describe (Panamá acepta 7 y 8 dígitos y su ejemplo es de 8):
//     ahí el código va aparte, que es seguro, y el número entero.
export function formatearTelefono(telefono: string): string {
  if (!/^\+\d+$/.test(telefono)) return telefono;
  const digitos = telefono.slice(1);

  // El país cuyo código abre el número y cuyo largo nacional acepta lo que queda. En paises.ts ningún
  // código es prefijo de otro, así que los candidatos comparten código: varios solo con el 1 de EE.UU.
  // y República Dominicana, que además parten igual.
  const candidatos = PAISES.filter(
    (p) => digitos.startsWith(p.codigo) && p.largos.includes(digitos.length - p.codigo.length),
  );
  if (candidatos.length === 0) return telefono;

  const codigo = candidatos[0].codigo;
  const nacional = digitos.slice(codigo.length);
  for (const pais of candidatos) {
    const grupos = pais.ejemplo.split(' ').map((g) => g.length);
    if (grupos.reduce((suma, g) => suma + g, 0) !== nacional.length) continue;
    const partes: string[] = [];
    let desde = 0;
    for (const largo of grupos) {
      partes.push(nacional.slice(desde, desde + largo));
      desde += largo;
    }
    return `+${codigo} ${partes.join(' ')}`;
  }
  return `+${codigo} ${nacional}`;
}
