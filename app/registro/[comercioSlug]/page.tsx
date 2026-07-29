import { createServiceClient } from '@/lib/supabase/server';
import { resolverProgramaPorSlug } from '@/lib/comercio/programas';
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
    .select('id, nombre')
    .eq('slug', comercioSlug)
    .maybeSingle();

  // Sin programa en la URL (QR viejo, de antes de la 0024): resuelve al principal, así el código
  // ya impreso en el mostrador sigue funcionando sin reimprimirse.
  const programa = comercio ? await resolverProgramaPorSlug(supabase, comercio.id, null) : null;

  if (!comercio || !programa) {
    return (
      <main className="shell">
        <div className="stack">
          <p className="kicker reveal d1">Cardly SV</p>
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

  return <RegistroCliente comercioSlug={comercioSlug} programaSlug={null} nombreComercio={comercio.nombre} />;
}
