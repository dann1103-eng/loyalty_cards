import { ImageResponse } from 'next/og';
import { ICONO_CARDLY_BASE64 } from './iconoCardlyDatos';

// Genera un ícono PNG REAL del tamaño pedido con next/og (incluido en Next, sin dependencia
// nueva): el ícono real de marca (la R de lazo en lima, sobre el noche de la landing) embebido
// como PNG en base64 y reescalado por Satori vía <img>. Decía "CS" (dos letras del acento
// naranja) antes de que existiera un logo de verdad — es el ícono que el cliente ve en la
// pantalla de inicio de su teléfono al instalar el portal de su tarjeta. Lo usan los íconos del
// manifest (192/512) y el apple-touch-icon (180).
//
// Se embebe en base64 y no se referencia por URL: Satori resuelve `<img src="...">` haciendo una
// petición de red aparte, y una ruta de Next.js generando OTRA ruta de Next.js en el mismo
// request es frágil (orden de arranque, base URL en distintos entornos). El archivo fuente
// (icono-badge.svg) vive en `public/marca/` para quien necesite editarlo o regenerar este base64.
export function renderIconoCardly(tamano: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori (next/og) no acepta next/image */}
        <img
          src={`data:image/png;base64,${ICONO_CARDLY_BASE64}`}
          width={tamano}
          height={tamano}
          alt=""
        />
      </div>
    ),
    { width: tamano, height: tamano },
  );
}
