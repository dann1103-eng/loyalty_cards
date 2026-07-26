// Resolución PURA de la "sucursal activa" del contexto (espeja resolverComercioActivo): decide qué
// hacer con la cookie sin cookies() ni BD, para testear la política sola.
//
// SEGURIDAD: para un CAJERO la cookie se IGNORA SIEMPRE — su sucursal es la de su membresía, que
// sale del gate, nunca del cliente (ver MUTATION-TESTING en el .test.ts). El id de
// 'validar-cookie' NO está verificado: el gate DEBE pasarlo por obtenerSucursalActiva
// (pertenencia + activa) antes de usarlo.
export type ResolucionSucursalActiva =
  | { tipo: 'todas' }
  | { tipo: 'fija-de-membresia'; sucursalId: string }
  | { tipo: 'validar-cookie'; sucursalId: string };

export function resolverSucursalActiva(
  rol: string,
  sucursalIdMembresia: string | null,
  cookieValue: string | undefined,
): ResolucionSucursalActiva {
  if (rol === 'cajero') {
    return sucursalIdMembresia
      ? { tipo: 'fija-de-membresia', sucursalId: sucursalIdMembresia }
      : { tipo: 'todas' };
  }
  return cookieValue
    ? { tipo: 'validar-cookie', sucursalId: cookieValue }
    : { tipo: 'todas' };
}
