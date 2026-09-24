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
// EL LÍMITE: el ejemplo es UN número de ese país, y agruparlos a todos como él solo sirve donde el
// número nacional tiene una forma fija (los 8 dígitos de Centroamérica, el 3-3-4 del 1). Donde el
// código de área cambia de largo —México 55 o 999, Argentina 11 o 351, los fijos de Chile 2 o 32— el
// ejemplo corta mal a los demás: "+52 99 9123 4567" sugiere el área 99 cuando es 999. Esos países
// están marcados en paises.ts (`areaVariable`) y acá se separa SOLO el código de país. En el resto,
// los grupos son los del ejemplo aunque la costumbre local para un fijo sea otra (España escribe "91
// 123 45 67" y acá sale "912 34 56 78"): los dígitos y el área no cambian, solo dónde van los espacios.
//
// Tampoco se agrupa, y sale tal cual o con solo el código aparte:
//   - lo que no es canónico (espacios, guiones, sin '+': datos viejos o de prueba), tal cual;
//   - un código que no está en la lista, o un largo que su país no acepta, tal cual;
//   - un largo válido que el ejemplo no describe (Panamá acepta 7 y 8 dígitos y su ejemplo es de 8):
//     el código aparte, que es seguro, y el número entero.
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
  if (candidatos.some((p) => p.areaVariable)) return `+${codigo} ${nacional}`;
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
