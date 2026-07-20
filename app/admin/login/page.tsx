import FormularioLogin from './FormularioLogin';

const MENSAJES: Record<string, string> = {
  'sin-permiso': 'Esa cuenta no tiene acceso al panel de FM.',
};

export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // Object.hasOwn y no MENSAJES[error] a secas: ?error=constructor devolvería
  // Object.prototype.constructor —una FUNCIÓN— y React revienta al intentar renderizarla.
  // Cualquiera puede escribir eso en la barra de direcciones. Un valor desconocido no muestra
  // nada, que es el comportamiento correcto.
  const mensaje = error && Object.hasOwn(MENSAJES, error) ? MENSAJES[error] : undefined;

  return (
    <main className="shell">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="icono-circulo reveal d1" style={{ width: 48, height: 48, background: 'var(--acento-fuerte)', color: 'var(--sobre-acento)', borderRadius: 14 }}>
          <span className="icono icono-lleno" style={{ fontSize: 26 }} aria-hidden="true">shield_person</span>
        </div>
        <h1 className="title reveal d2" style={{ marginTop: 12 }}>FM Lealtad</h1>
        <p className="lede reveal d2" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
          Panel interno
        </p>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <FormularioLogin mensajeInicial={mensaje} />
        </div>
        <p className="nota reveal d4">Solo cuentas de FM Communications</p>
      </div>
    </main>
  );
}
