import FormularioLoginComercio from './FormularioLoginComercio';

const MENSAJES: Record<string, string> = {
  'sin-permiso': 'Esa cuenta no tiene acceso al panel del comercio.',
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
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">
          Panel del <em>comercio</em>
        </h1>
        <FormularioLoginComercio mensajeInicial={mensaje} />
      </div>
    </main>
  );
}
