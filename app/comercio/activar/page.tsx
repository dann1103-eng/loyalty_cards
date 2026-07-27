import Link from 'next/link';
import FormularioActivar from './FormularioActivar';

export const dynamic = 'force-dynamic';

// Pantalla de bienvenida del link que FM le comparte al dueño por WhatsApp. Abrir esta página NO
// canjea nada: solo muestra el botón. El canje vive en la Server Action (POST) porque el token es
// de UN SOLO USO y los mensajeros abren los links con un GET para armar la vista previa — con el
// canje en el GET, el preview de WhatsApp quemaba el link antes de que el cliente lo tocara (pasó
// en producción el 2026-07-26).
//
// El invitado llega SIN sesión: por eso proxy.ts exime esta ruta. Sin la exención el link caería en
// /comercio/login y el flujo se rompe entero.
export default async function PaginaActivar({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; tipo?: string }>;
}) {
  const { token_hash: tokenHash, tipo } = await searchParams;
  const linkCompleto = Boolean(tokenHash && tipo);

  return (
    <main className="shell">
      <div className="stack" style={{ maxWidth: 460 }}>
        <div className="reveal d1" style={{ textAlign: 'center' }}>
          <div
            className="icono-circulo"
            style={{ width: 48, height: 48, margin: '0 auto', background: 'var(--acento-fuerte)', color: 'var(--sobre-acento)', borderRadius: 14 }}
          >
            <span className="icono icono-lleno" style={{ fontSize: 26 }} aria-hidden="true">storefront</span>
          </div>
          <h1 className="title" style={{ marginTop: 14, fontSize: '1.6rem' }}>
            {linkCompleto ? 'Activá tu acceso' : 'Link incompleto'}
          </h1>
          <p className="lede" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
            {linkCompleto
              ? 'Tocá el botón para entrar y definir tu contraseña. Este link se usa una sola vez.'
              : 'Este link está incompleto o mal copiado. Pedí uno nuevo a soporte@cardly-sv.site.'}
          </p>
        </div>

        {linkCompleto ? (
          <FormularioActivar tokenHash={tokenHash!} tipo={tipo!} />
        ) : (
          <p className="nota reveal d3">
            <Link href="/comercio/login">Ir al inicio de sesión</Link>
          </p>
        )}

        <p className="nota reveal d4">Sistema seguro · Cardly SV</p>
      </div>
    </main>
  );
}
