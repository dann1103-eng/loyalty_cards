import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import Escaner from './Escaner';

export const dynamic = 'force-dynamic';

// Pantalla C7 (Fase 4): el cajero escanea el QR del pass del cliente (o el impreso del panel) y
// suma sellos/puntos o canjea recompensas. También acepta ?token= para llegar sin cámara desde
// el directorio de clientes.
export default async function PaginaEscanear({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await verifyComercioOwner();
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
