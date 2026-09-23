import { createServiceClient } from '@/lib/supabase/server';
import { hoyEnZona } from '@/lib/tarjetas/vigencia';
import { resolverProgramaPorSlug } from '@/lib/comercio/programas';
import { leerResenaGoogle } from '@/lib/comercio/resenaGoogle';
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
    .select('id, nombre, zona_horaria')
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

  // La marca y la reseña se piden DESPUÉS de resolver el programa, y no en paralelo con el comercio:
  // la marca hereda del programa (migración 0027) y sin él no hay de qué heredar. Un QR de un
  // comercio inexistente no paga ninguna de las dos consultas.
  //
  // leerResenaGoogle es una consulta APARTE de la del comercio de arriba (que decide "no
  // encontrado"), no un ensanche de su `select`: si falla —incluido que la migración 0039 todavía
  // no esté aplicada— devuelve `null` y el registro sigue en pie sin el paso de reseña, mismo
  // criterio de falla suave que marcaDelRegistro (ver ese archivo).
  const [marca, resena] = await Promise.all([
    marcaDelRegistro(supabase, comercio.id, programa.id),
    leerResenaGoogle(supabase, comercio.id),
  ]);

  return (
    <RegistroCliente
      comercioSlug={comercioSlug}
      programaSlug={null}
      nombreComercio={comercio.nombre}
      tipoTarjeta={programa.tipoTarjeta}
      selloMeta={programa.selloMeta}
      marca={marca}
      resenaGoogleUrl={resena?.pedir ? resena.url : null}
      // El "hoy" del COMERCIO, resuelto acá: la tarjeta de muestra es 'use client' y un new Date()
      // adentro daría mismatch de hidratación (y en UTC correría el vencimiento un día).
      hoyIso={hoyEnZona(comercio.zona_horaria)}
    />
  );
}
