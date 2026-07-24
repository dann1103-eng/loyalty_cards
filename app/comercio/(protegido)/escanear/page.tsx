import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import Escaner from './Escaner';

export const dynamic = 'force-dynamic';

// Pantalla C7 (Fase 4): el cajero escanea el QR del pass del cliente (o el impreso del panel) y
// suma sellos/puntos o canjea recompensas. También acepta ?token= para llegar sin cámara desde
// el directorio de clientes.
//
// Gate COMPARTIDO (Fase 7), no owner-only: el escáner es la pantalla del CAJERO. Con
// verifyComercioOwner() un cajero era rebotado a /comercio/escanear → loop infinito de redirect.
// verifyComercioAcceso() admite owner Y cajero. La atribución completa (qué sucursal registra cada
// operación) y el ajuste de las Server Actions del escáner llegan en Fase 9; acá solo se garantiza
// que el cajero pueda ENTRAR. La página no usa datos del gate (solo pasa el token del querystring).
export default async function PaginaEscanear({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await verifyComercioAcceso();
  const { token } = await searchParams;

  return (
    <main className="admin-main" style={{ maxWidth: 560 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Escanear tarjeta</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <Escaner tokenInicial={token} />
    </main>
  );
}
