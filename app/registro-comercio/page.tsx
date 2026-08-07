import type { Metadata } from 'next';
import Link from 'next/link';
import FormularioRegistro from './FormularioRegistro';
import { openGraphDe, twitterDe } from '@/lib/metadatosOg';

export const dynamic = 'force-dynamic';

// SIN la marca: el layout raíz ya le agrega " · Cardly SV" con su `template`. Ponerla acá daba
// "Creá tu cuenta — Cardly SV · Cardly SV" (visto en el navegador, no supuesto).
const TITULO = 'Creá tu cuenta';
const DESCRIPCION =
  'Registrá tu negocio y empezá a darle tarjetas de lealtad a tus clientes hoy mismo. Sin instalar nada.';

export const metadata: Metadata = {
  title: TITULO,
  description: DESCRIPCION,
  openGraph: openGraphDe({ titulo: TITULO, descripcion: DESCRIPCION, url: '/registro-comercio' }),
  twitter: twitterDe({ titulo: TITULO, descripcion: DESCRIPCION }),
  // Es un formulario de alta, no una página de contenido: no aporta nada en resultados de búsqueda
  // y compite con la portada por la misma consulta.
  robots: { index: false, follow: true },
};

// Alta self-service. Reemplaza los cuatro pasos manuales que había entre "conozco Cardly" y "estoy
// usando mi panel": formulario de interés → FM crea la cuenta → FM crea el comercio → FM manda un
// link de invitación por WhatsApp.
export default async function PaginaRegistroComercio({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  // El plan llega preseleccionado desde la tabla de precios de la portada: quien ya eligió ahí no
  // tiene que volver a elegir acá. Un valor inventado simplemente cae al default del formulario —
  // la validación real vive en crearCuentaAutoservicio, no en este parámetro.
  const { plan } = await searchParams;

  return (
    <main className="shell">
      <div className="stack" style={{ maxWidth: 460 }}>
        <div className="reveal d1" style={{ textAlign: 'center' }}>
          <div
            className="icono-circulo"
            style={{
              width: 48,
              height: 48,
              margin: '0 auto',
              background: 'var(--acento-fuerte)',
              color: 'var(--sobre-acento)',
              borderRadius: 14,
            }}
          >
            <span className="icono icono-lleno" style={{ fontSize: 26 }} aria-hidden="true">storefront</span>
          </div>
          <h1 className="title" style={{ marginTop: 14, fontSize: '1.6rem' }}>Creá tu cuenta</h1>
          <p className="lede" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
            En un minuto tenés tu tarjeta de lealtad lista para que tus clientes la guarden en el
            celular. No hay nada que instalar.
          </p>
        </div>

        <div className="reveal d2">
          <FormularioRegistro planInicial={plan} />
        </div>

        <p className="nota reveal d3" style={{ textAlign: 'center' }}>
          ¿Ya tenés cuenta? <Link href="/comercio/login">Entrá acá</Link>.
        </p>
      </div>
    </main>
  );
}
