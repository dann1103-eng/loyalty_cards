import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';

export const dynamic = 'force-dynamic';

// Pantalla C7 del diseño: el flujo de escanear el QR del cliente para sumar sellos/puntos.
// El escáner funcional llega en la Fase 4 (requiere además proteger el endpoint de puntos con el
// gate del comercio). Mientras tanto, la pantalla existe y es honesta — igual que los tipos de
// tarjeta "(Próximamente)": no se promete lo que aún no funciona.
export default async function PaginaEscanear() {
  await verifyComercioOwner();

  return (
    <main className="admin-main" style={{ maxWidth: 560 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Escanear tarjeta</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <section className="panel reveal d2" style={{ marginTop: 0, textAlign: 'center', padding: '40px 24px' }}>
        <span className="icono-circulo acento" style={{ width: 64, height: 64, margin: '0 auto 16px' }} aria-hidden="true">
          <span className="icono" style={{ fontSize: 32 }}>qr_code_scanner</span>
        </span>
        <h2 className="admin-fila-nombre" style={{ fontSize: '1.2rem' }}>Muy pronto</h2>
        <p style={{ color: 'var(--texto-2)', fontSize: '0.92rem', marginTop: 8, maxWidth: '38ch', marginInline: 'auto' }}>
          Desde acá vas a apuntar la cámara al pass del cliente (o a su QR impreso) y sumarle
          sellos o puntos con un toque.
        </p>
        <p className="nota">
          Mientras tanto, encontrá el QR de cada cliente en{' '}
          <Link href="/comercio/clientes" style={{ color: 'var(--acento)' }}>Clientes</Link>.
        </p>
      </section>
    </main>
  );
}
