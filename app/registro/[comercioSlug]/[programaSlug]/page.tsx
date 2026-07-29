import { createServiceClient } from '@/lib/supabase/server';
import { resolverProgramaPorSlug } from '@/lib/comercio/programas';
import RegistroCliente from '../RegistroCliente';

export const dynamic = 'force-dynamic';

// El QR de un programa NO principal (migración 0024) apunta acá: /registro/<comercio>/<programa>.
// El QR viejo del comercio, sin este segundo segmento, lo sigue resolviendo el page.tsx del padre.
export default async function PaginaRegistroPrograma({
  params,
}: {
  params: Promise<{ comercioSlug: string; programaSlug: string }>;
}) {
  const { comercioSlug, programaSlug } = await params;
  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('id, nombre')
    .eq('slug', comercioSlug)
    .maybeSingle();

  const programa = comercio ? await resolverProgramaPorSlug(supabase, comercio.id, programaSlug) : null;

  if (!comercio || !programa) {
    return (
      <main className="shell">
        <div className="stack">
          <p className="kicker reveal d1">Cardly SV</p>
          <h1 className="title reveal d2">
            Tarjeta <em>no encontrada</em>
          </h1>
          <p className="lede reveal d2">
            No encontramos esa tarjeta. Revisa el enlace o escanea de nuevo el código QR en el
            mostrador.
          </p>
        </div>
      </main>
    );
  }

  return (
    <RegistroCliente comercioSlug={comercioSlug} programaSlug={programaSlug} nombreComercio={comercio.nombre} />
  );
}
