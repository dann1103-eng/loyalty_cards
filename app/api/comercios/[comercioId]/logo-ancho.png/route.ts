import type { NextRequest } from 'next/server';
import { componerLogoAncho } from '@/lib/google/componerLogo';
import { servirLogoClase } from '@/lib/google/servirLogoClase';

export const runtime = 'nodejs';

// El `wideProgramLogo` de la LoyaltyClass de Google: 1280×400 transparente, con el logo entero pegado a
// la izquierda y centrado en alto (lib/google/componerLogo.ts). En Android reemplaza la cabecera por
// defecto (círculo + nombre) por el logo completo. La clase solo lo pide para logos apaisados
// (logosDeClase, lib/google/logosClase.ts, que arma la URL con su `?v=`).
//
// `?programa=<id>` compone con la marca efectiva de ese programa, como logo.png.
//
// Tampoco puede fallar para un comercio con logo: Google rechaza el patch ENTERO de la clase si no
// puede bajar una de sus imágenes, así que si la composición falla se sirve el logo original (ver
// lib/google/servirLogoClase.ts). Si el bucket no responde: 502, NUNCA una redirección al logo crudo,
// porque Google la cachearía bajo esta URL versionada; con el 502 el próximo sync reintenta. Un "logo"
// que ni sharp puede leer también es 502: sus bytes nunca se reenvían tal cual.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ comercioId: string }> },
) {
  const { comercioId } = await params;
  return servirLogoClase(request, comercioId, (logo) => componerLogoAncho(logo));
}
