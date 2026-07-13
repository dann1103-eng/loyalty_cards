import { createServiceClient } from '@/lib/supabase/server';
import RegistroCliente from './RegistroCliente';

export const dynamic = 'force-dynamic';

export default async function PaginaRegistro({
  params,
}: {
  params: Promise<{ comercioSlug: string }>;
}) {
  const { comercioSlug } = await params;
  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('nombre')
    .eq('slug', comercioSlug)
    .maybeSingle();

  if (!comercio) {
    return (
      <main className="shell">
        <div className="stack">
          <p className="kicker reveal d1">FM Lealtad</p>
          <h1 className="title reveal d2">
            Comercio <em>no encontrado</em>
          </h1>
          <p className="lede reveal d2">
            No hay ningún comercio con la dirección <strong>/{comercioSlug}</strong>.
            Revisa el enlace o escanea de nuevo el código QR en el mostrador.
          </p>
        </div>
      </main>
    );
  }

  return <RegistroCliente comercioSlug={comercioSlug} nombreComercio={comercio.nombre} />;
}
