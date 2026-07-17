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
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">
          Panel <em>interno</em>
        </h1>
        <FormularioLogin mensajeInicial={mensaje} />
      </div>
    </main>
  );
}
