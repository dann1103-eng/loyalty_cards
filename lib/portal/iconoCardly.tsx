import { ImageResponse } from 'next/og';

// Genera un ícono PNG REAL del tamaño pedido con next/og (incluido en Next, sin dependencia
// nueva): fondo oscuro de la marca + las iniciales de Cardly SV en el acento naranja. Decía "FM"
// hasta el rebranding, y era lo MÁS visible que quedaba del nombre viejo: es el ícono que el
// cliente ve en la pantalla de inicio de su teléfono al instalar el portal de su tarjeta. Lo usan los íconos del
// manifest (192/512) y el apple-touch-icon (180). Satori (dentro de ImageResponse) rasteriza el
// texto con su fuente por defecto, así que dos letras latinas no necesitan cargar ninguna fuente.
// (Colores adaptados del plan original —espresso/crema— al sistema Stitch dark del rediseño.)
export function renderIconoCardly(tamano: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#131313',
          color: '#ff9d42',
          fontSize: tamano * 0.42,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        CS
      </div>
    ),
    { width: tamano, height: tamano },
  );
}
