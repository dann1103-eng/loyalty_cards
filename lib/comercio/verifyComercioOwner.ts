import 'server-only';

import { redirect } from 'next/navigation';
import { verifyComercioAcceso, verifyComercioAccesoSinBloqueo } from './verifyComercioAcceso';

// verifyComercioAcceso() y verifyComercioAccesoSinBloqueo() devuelven EXACTAMENTE la misma forma
// (la segunda es la fuente; la primera solo le agrega el redirect() de bloqueo antes de devolverla
// tal cual) — de ahí que soloOwner() de abajo sirva para las dos.
type AccesoComercio = Awaited<ReturnType<typeof verifyComercioAccesoSinBloqueo>>;

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
  return soloOwner(await verifyComercioAcceso());
}

// Misma exigencia de rol owner que verifyComercioOwner(), pero SIN el bloqueo por cobranza: llama a
// verifyComercioAccesoSinBloqueo() en vez de verifyComercioAcceso(). Para las 3 páginas "excepción"
// (spec cobranza, "Cómo se bloquea") que un dueño BLOQUEADO todavía necesita ver — /comercio/plan
// (con `?suspendida=1`), el resultado de un pago que acaba de hacer y su comprobante. Si usaran
// verifyComercioOwner(), el bloqueo las echaría a ELLAS TAMBIÉN (verifyComercioAcceso hereda el
// redirect), dejando al dueño sin forma de pagar para desbloquearse.
export async function verifyComercioOwnerSinBloqueo() {
  return soloOwner(await verifyComercioAccesoSinBloqueo());
}

// El chequeo de rol es idéntico para las dos variantes de arriba: solo cambia si el acceso de base
// viene con o sin el redirect() de bloqueo ya aplicado.
function soloOwner(acceso: AccesoComercio) {
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
    sucursalActiva: acceso.sucursalActiva,
    comercios: acceso.membresias
      .filter((m) => m.rol === 'owner')
      .map((m) => ({ comercioId: m.comercioId, nombre: m.nombre })),
  };
}
