// Resolución PURA de la sucursal que se ATRIBUYE a una operación del escáner (acreditar/canjear),
// separada de las Server Actions para poder testear la política sin un contexto de request de Next
// (mismo estilo que resolverComercioActivo).
//
// SEGURIDAD: es el candado que impide que un CAJERO atribuya una operación a una sucursal que no es
// la suya. Un cajero está atado a UNA sucursal por su membresía (sucursalIdSesion, que sale SIEMPRE
// del gate, nunca del cliente): su operación se atribuye SIEMPRE a esa, aunque el cliente mande otra.
// El owner no tiene sucursal fija: elige en el picker (sucursalIdCliente), y esa elección la valida
// la acción con sucursalPerteneceAComercio ANTES de escribir. (Ver MUTATION-TESTING en el .test.ts:
// si para 'cajero' se confiara en el valor del cliente, un cajero podría atribuir visitas ajenas.)
export function resolverSucursalDeAccion(
  rol: string,
  sucursalIdSesion: string | null,
  sucursalIdCliente: string | null,
): string | null {
  if (rol === 'cajero') {
    return sucursalIdSesion;
  }
  return sucursalIdCliente;
}
