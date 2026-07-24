import { redirect } from 'next/navigation';
import { createClienteServidor, createServiceClient } from '@/lib/supabase/server';
import { membresiasDeUsuario } from '@/lib/comercio/membresiasDeUsuario';
import { cerrarSesionComercio } from '../actions';
import { elegirComercio } from './actions';

export const dynamic = 'force-dynamic';

// Pantalla de selección de comercio para una cuenta que administra VARIOS (2+ membresías owner).
// Vive FUERA de (protegido): si estuviera dentro, el gate del layout que redirige acá crearía un
// loop. Gate liviano propio (sesión + membresías), sin verifyComercioAcceso (ese redirige justamente
// a esta página cuando hay 2+ sin cookie válida).
//
// OJO: redirect() funciona LANZANDO NEXT_REDIRECT → va SIEMPRE fuera de try/catch. Un Server
// Component NO puede escribir cookies; por eso el caso de 1 sola membresía NO fija cookie: con una
// única membresía resolverComercioActivo resuelve directo (la cookie es irrelevante) y el panel la
// toma sin más. La escritura de cookie ocurre solo en el Server Action elegirComercio (al elegir).
export default async function PaginaElegirComercio() {
  const supabase = await createClienteServidor();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    console.warn('[comercio] getClaims() falló en /elegir; se trata como sesión ausente:', error);
  }
  const sub = data?.claims?.sub;
  if (!sub) {
    redirect('/comercio/login');
  }

  // usuarios_comercio es deny-all bajo RLS → service client.
  const membresias = await membresiasDeUsuario(createServiceClient(), sub);

  if (membresias.length === 0) {
    redirect('/comercio/login?error=sin-permiso');
  }
  if (membresias.length === 1) {
    // Una sola membresía: no hay nada que elegir y la cookie es irrelevante (resolverComercioActivo
    // resuelve directo). Al panel; si es cajero, el panel/gate lo reencamina al escáner.
    redirect('/comercio/panel');
  }

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
          <h1 className="title" style={{ marginTop: 14, fontSize: '1.6rem' }}>Elegí tu comercio</h1>
          <p className="lede" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
            Tu cuenta administra varios. Entrá al que querés gestionar.
          </p>
        </div>

        <div className="admin-lista reveal d2" style={{ marginTop: 22 }}>
          {membresias.map((m) => (
            <form key={m.usuarioComercioId} action={elegirComercio.bind(null, m.comercioId)}>
              <button
                className="admin-fila"
                type="submit"
                style={{ width: '100%', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">storefront</span>
                  </span>
                  <span className="admin-fila-nombre">{m.nombre}</span>
                </span>
                <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
              </button>
            </form>
          ))}
        </div>

        <form action={cerrarSesionComercio} className="reveal d3" style={{ marginTop: 18, textAlign: 'center' }}>
          <button className="admin-fila-slug" type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            ¿No es tu cuenta? Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
