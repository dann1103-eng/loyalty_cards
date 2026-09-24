import type { NextRequest } from 'next/server';
import { componerLogoCuadrado } from '@/lib/google/componerLogo';
import { servirLogoClase } from '@/lib/google/servirLogoClase';

export const runtime = 'nodejs';

// El `programLogo` de la LoyaltyClass de Google: 660×660 con el color de la tarjeta a sangre y el logo
// ENTERO en el área segura central, para que el círculo en el que Google lo recorta no se coma nada
// (lib/google/componerLogo.ts). Hasta el 2026-09-23 la clase apuntaba al logo crudo, y un logo ancho
// como el de Pulso Café quedaba cortado y diminuto en Android.
//
// `?programa=<id>` compone con la marca efectiva de ese programa (la clase propia de un programa, ver
// syncClasePrograma). La URL la arma logosDeClase (lib/google/logosClase.ts), con su `?v=`.
//
// Esta ruta NO puede fallar para un comercio con logo: si la composición falla sirve el logo original,
// porque Google rechaza el patch ENTERO de la clase si no puede bajar su programLogo (el porqué largo,
// en lib/google/servirLogoClase.ts). La única excepción es un bucket que no responde: 502, y NUNCA una
// redirección al logo crudo, porque Google lo cachearía bajo esta URL versionada y el logo recortado
// quedaría puesto hasta el próximo cambio de logo o de color; con el 502 el próximo sync reintenta.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ comercioId: string }> },
) {
  const { comercioId } = await params;
  return servirLogoClase(request, comercioId, (logo, marca) => componerLogoCuadrado(logo, marca.colorFondo));
}
