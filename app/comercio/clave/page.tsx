import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClienteServidor } from '@/lib/supabase/server';
import FormularioClave from './FormularioClave';

export const dynamic = 'force-dynamic';

// Pantalla donde el dueño invitado define SU contraseña, justo después de canjear el link en
// /comercio/activar. Vive FUERA de (protegido) porque todavía no hay nada que proteger con el gate
// del panel: la cuenta recién activada puede no tener comercio activo resuelto y verifyComercioAcceso
// la mandaría a /elegir o al login. Acá alcanza con que la sesión exista.
//
// NO necesita exención en proxy.ts: cuando el cliente llega, la activación ya creó la sesión.
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT → getClaims() y redirect() van SIEMPRE fuera de
// cualquier try/catch, o el gate queda desactivado.
export default async function PaginaDefinirClave() {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló en /clave; se trata como sesión ausente:', error);
  }
  const claims = data?.claims;
  if (!claims?.sub) {
    // Sin ?error a propósito: proxy.ts ya intercepta esta ruta sin sesión y manda al login pelado
    // (limpia el querystring). Esto es el respaldo del gate, no el camino normal.
    redirect('/comercio/login');
  }

  const correo = typeof claims.email === 'string' ? claims.email : null;

  return (
    <main className="shell">
      <div className="stack" style={{ maxWidth: 460 }}>
        <div className="reveal d1" style={{ textAlign: 'center' }}>
          <div
            className="icono-circulo"
            style={{ width: 48, height: 48, margin: '0 auto', background: 'var(--acento-fuerte)', color: 'var(--sobre-acento)', borderRadius: 14 }}
          >
            <span className="icono icono-lleno" style={{ fontSize: 26 }} aria-hidden="true">lock</span>
          </div>
          <h1 className="title" style={{ marginTop: 14, fontSize: '1.6rem' }}>Definí tu contraseña</h1>
          <p className="lede" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
            Es la clave con la que vas a entrar a tu panel de Cardly SV. La elegís vos: ni nosotros la
            ve ni queda guardada en ningún lado.
          </p>
          {correo && (
            <p className="admin-fila-slug" style={{ marginTop: 10 }}>
              Tu cuenta: <span className="dato-mono">{correo}</span>
            </p>
          )}
        </div>

        <div style={{ width: '100%', textAlign: 'left' }}>
          <FormularioClave />
        </div>

        {/* Un dueño que YA tiene clave puede aterrizar acá al volver a tocar un link viejo de
            WhatsApp: este atajo evita que quede atrapado en una pantalla que no necesita. */}
        <p className="nota reveal d4">
          ¿Ya la tenías? <Link href="/comercio/panel">Entrá a tu panel</Link>
        </p>
      </div>
    </main>
  );
}
