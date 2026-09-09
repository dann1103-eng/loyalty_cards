import { createServiceClient } from '@/lib/supabase/server';
import { resolverProgramaPorSlug } from '@/lib/comercio/programas';
import { marcaDelRegistro } from './marcaDelRegistro';
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

  // La marca se pide DESPUÉS de resolver el programa, y no en paralelo con el comercio: hereda del
  // programa (migración 0027) y sin él no hay de qué heredar. Un QR de un comercio inexistente no
  // paga esta consulta.
  const marca = await marcaDelRegistro(supabase, comercio.id, programa.id);

  return (
    <RegistroCliente
      comercioSlug={comercioSlug}
      programaSlug={null}
      nombreComercio={comercio.nombre}
      tipoTarjeta={programa.tipoTarjeta}
      selloMeta={programa.selloMeta}
      marca={marca}
    />
  );
}
