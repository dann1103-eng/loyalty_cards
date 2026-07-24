import 'server-only';

import { redirect } from 'next/navigation';
import { verifyComercioAcceso } from './verifyComercioAcceso';

// Gate del panel del DUEÑO. Wrapper delgado sobre verifyComercioAcceso() que además exige que el
// comercio activo sea uno donde la cuenta es owner. Se llama desde el layout, CADA página y CADA
// Server Action del panel (los layouts no se re-renderizan en navegación de cliente, y los Server
// Actions son POST a su ruta — los docs de Next exigen verificar auth dentro de cada acción).
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT. verifyComercioAcceso() y estos redirect() van
// SIEMPRE fuera de cualquier try/catch, o se desactiva el gate.
//
// Devuelve comercioId para que las acciones scopeen SIEMPRE por la sesión verificada — nunca por un
// campo del formulario (un comercio_id del cliente dejaría a un dueño sobrescribir datos de OTRO
// comercio). `comercios` lista todos los comercios donde es owner (para el selector multi-comercio).
export async function verifyComercioOwner() {
  const acceso = await verifyComercioAcceso();

  if (acceso.rol !== 'owner') {
    // El comercio activo NO es de owner. Si la cuenta es cajero en algún lado, su lugar es el
    // escáner; si no, no tiene permiso de panel.
    if (acceso.membresias.some((m) => m.rol === 'cajero')) {
      redirect('/comercio/escanear');
    }
    redirect('/comercio/login?error=sin-permiso');
  }

  return {
    authUserId: acceso.authUserId,
    comercioId: acceso.comercioId,
    nombre: acceso.nombre,
    comercios: acceso.membresias
      .filter((m) => m.rol === 'owner')
      .map((m) => ({ comercioId: m.comercioId, nombre: m.nombre })),
  };
}
