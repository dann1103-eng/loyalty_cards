import FormularioLoginComercio from './FormularioLoginComercio';

const MENSAJES: Record<string, string> = {
  'sin-permiso': 'Esa cuenta no tiene acceso al panel del comercio.',
  // Lo manda /comercio/activar cuando el link de invitación no sirve: ya se usó (es de un solo
  // uso), venció (24 h) o llegó cortado. El cliente no puede resolverlo solo — el único camino es
  // que FM le genere otro desde la ficha del comercio.
  'link-vencido':
    'Ese link de acceso ya no sirve: se usa una sola vez y vence a las 24 horas. Pedí uno nuevo a soporte@cardly-sv.site.',
};

export default async function PaginaLoginComercio({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // Object.hasOwn, no MENSAJES[error] a secas: ?error=constructor devolvería una FUNCIÓN
  // (Object.prototype.constructor) y React revienta al renderizarla. Un valor desconocido no
  // muestra nada, que es lo correcto.
  const mensaje = error && Object.hasOwn(MENSAJES, error) ? MENSAJES[error] : undefined;

  return (
    <main className="shell">
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="icono-circulo reveal d1" style={{ width: 48, height: 48, background: 'var(--acento-fuerte)', color: 'var(--sobre-acento)', borderRadius: 14 }}>
          <span className="icono icono-lleno" style={{ fontSize: 26 }} aria-hidden="true">storefront</span>
        </div>
        <h1 className="title reveal d2" style={{ marginTop: 12 }}>Cardly SV</h1>
        <p className="lede reveal d2" style={{ marginTop: 6, color: 'var(--texto-2)' }}>
          Panel del comercio
        </p>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <FormularioLoginComercio mensajeInicial={mensaje} />
        </div>
        <p className="nota reveal d4">Sistema seguro · Cardly SV</p>
      </div>
    </main>
  );
}
