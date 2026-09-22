import { verifyComercioAccesoSinBloqueo } from '@/lib/comercio/verifyComercioAcceso';

export const dynamic = 'force-dynamic';

// Pantalla del CAJERO cuando la cuenta del comercio está `bloqueada` (spec 2026-09-21-cobranza-design.md,
// "Cómo se bloquea" y "Pantallas → Dueño", último ítem). Es un callejón sin salida a propósito: el
// cajero no tiene botón de pago (solo el dueño puede pagar, en /comercio/plan) ni nada más que hacer
// acá.
//
// Vive FUERA de (protegido), igual que /comercio/elegir y /comercio/login: si estuviera adentro,
// heredaría el layout que llama a verifyComercioAccesoSinBloqueo() otra vez (sin problema, está
// memoizada por render) pero además dibujaría la nav/header completos del panel alrededor de un
// mensaje de "no podés usar el panel" — ruido que esta pantalla no necesita.
//
// Usa la variante SIN bloqueo del gate a propósito: si usara verifyComercioAcceso() (la que
// bloquea), un cajero bloqueado que "aterriza" acá por el redirect del gate volvería a rebotar en
// loop contra esta misma página.
export default async function PaginaComercioSuspendida() {
  const { nombre } = await verifyComercioAccesoSinBloqueo();

  return (
    <main className="shell">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div
          className="icono-circulo reveal d1"
          style={{ width: 48, height: 48, background: 'var(--acento-fuerte)', color: 'var(--sobre-acento)', borderRadius: 14 }}
        >
          <span className="icono icono-lleno" style={{ fontSize: 26 }} aria-hidden="true">storefront</span>
        </div>
        <h1 className="title reveal d2" style={{ marginTop: 12 }}>{nombre}</h1>
        <p className="lede reveal d2" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
          La cuenta está suspendida. Avisale al dueño.
        </p>
      </div>
    </main>
  );
}
