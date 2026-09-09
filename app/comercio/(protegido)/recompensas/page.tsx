import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_RECOMPENSA } from '@/lib/comercio/recompensas';
import { listarProgramas } from '@/lib/comercio/programas';
import { unidadPrograma, describirCosto } from '@/lib/tarjetas/unidadPrograma';
import { puedeCanjearRecompensas } from '@/lib/tarjetas/tipos';
import FormularioRecompensa from './FormularioRecompensa';
import BotonDesactivarRecompensa from './BotonDesactivarRecompensa';
import FotoRecompensa from './FotoRecompensa';
import AvisoComercioActivo from '../AvisoComercioActivo';

export const dynamic = 'force-dynamic';

export default async function PaginaRecompensas() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();

  // La UNIDAD con la que se paga un premio sale del programa principal, no de una palabra fija.
  // Antes decia "Costo en puntos" y "8 puntos" a TODO comercio, incluido uno de sellos: el dueno
  // cargaba su premio leyendo una moneda que su propio programa no usa.
  const programas = await listarProgramas(supabase, comercioId);
  const principal = (programas ?? []).find((p) => p.esPrincipal) ?? null;
  const tipoPrincipal = principal?.tipoTarjeta ?? 'puntos';
  const unidad = unidadPrograma(tipoPrincipal);
  // Un premio se canjea descontando `puntos_actuales`, y en cupón, membresía y descuento ese
  // contador es 0 siempre (su estado es una fecha o un nivel). O sea que un premio cargado acá NO
  // se podría canjear nunca —— y la pantalla igual ofrecía el formulario. Mismo criterio que
  // reglas/page.tsx con el formulario de acumulación: se dice por qué y se manda a donde sí hay algo.
  const puedeCanjear = puedeCanjearRecompensas(tipoPrincipal);

  const { data: recompensas, error } = await supabase
    .from('recompensas')
    .select('id, nombre, descripcion, costo_puntos, tipo, foto_url')
    .eq('comercio_id', comercioId)
    .eq('activa', true) // las desactivadas siguen en la BD (soft-delete), pero no se listan
    .order('costo_puntos');

  if (error) console.error('[comercio] falló la consulta de recompensas:', error);

  const etiquetaTipo = (tipo: string) => TIPOS_RECOMPENSA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;
  const costoTexto = (costo: number) => describirCosto(tipoPrincipal, costo);

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Recompensas</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <AvisoComercioActivo />

      <div className="reveal d2">
        {puedeCanjear ? (
          <FormularioRecompensa unidad={unidad} />
        ) : (
          <p className="admin-vacio">
            Tu tarjeta no acumula un contador del que descontar, así que un premio cargado acá no
            se podría canjear nunca. Lo que gana tu cliente se define en{' '}
            <Link href="/comercio/programas">Programas de tarjeta</Link>.
          </p>
        )}
      </div>

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar las recompensas. Recarga la página.</p>
        ) : !recompensas || recompensas.length === 0 ? (
          <p className="admin-vacio">Todavía no hay recompensas. Agrega la primera.</p>
        ) : (
          recompensas.map((r) => (
            <div
              key={r.id}
              className="admin-fila"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                  <span className="icono-circulo acento" aria-hidden="true">
                    <span className="icono">redeem</span>
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="admin-fila-nombre">{r.nombre}</div>
                    {/* describirCosto y no el entero pelado: en gift card y cashback el costo son
                        CENTAVOS, así que un premio de 250 se leía "250" en vez de "$2.50". Y en los
                        tipos sin contador devuelve cadena vacía —— antes quedaba "8  · Artículo
                        gratis", con el doble espacio de la unidad que no existe. */}
                    <div className="admin-fila-slug">
                      {costoTexto(r.costo_puntos) && (
                        <>
                          <span className="dato-mono">{costoTexto(r.costo_puntos)}</span>
                          {' · '}
                        </>
                      )}
                      {etiquetaTipo(r.tipo)}
                      {r.descripcion ? ` · ${r.descripcion}` : ''}
                    </div>
                  </div>
                </div>
                <BotonDesactivarRecompensa id={r.id} nombre={r.nombre} />
              </div>
              {/* La foto se ve en el escáner del cajero y en el portal del cliente. NO dentro de la
                  tarjeta de la billetera: el reverso de Apple son campos de TEXTO y no admite
                  imágenes por premio. */}
              <FotoRecompensa recompensaId={r.id} fotoUrl={r.foto_url} nombre={r.nombre} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
