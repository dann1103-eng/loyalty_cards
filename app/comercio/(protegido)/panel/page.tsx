import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';

export const dynamic = 'force-dynamic';

export default async function PaginaPanel() {
  // Defensa en profundidad: el layout ya verificó, pero no se re-ejecuta en navegación del
  // cliente. cache() hace que no cueste una consulta extra.
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: comercio } = await supabase
    .from('comercios')
    .select('nombre, tipo_tarjeta')
    .eq('id', comercioId)
    .maybeSingle();

  const tipo = TIPOS_TARJETA.find((t) => t.valor === comercio?.tipo_tarjeta);

  return (
    <main className="admin-main">
      <div className="admin-encabezado">
        <h1 className="title" style={{ fontSize: '2rem', margin: 0 }}>Tu comercio</h1>
      </div>

      <div className="panel" style={{ marginTop: 0 }}>
        <p className="admin-fila-slug">Tipo de tarjeta</p>
        <p className="admin-fila-nombre">{tipo?.etiqueta ?? comercio?.tipo_tarjeta}</p>
        {tipo && <p className="nota" style={{ textAlign: 'left', margin: '6px 0 0' }}>{tipo.descripcion}</p>}
      </div>

      <div className="panel-atajos">
        <Link className="admin-fila" href="/comercio/branding">
          <div>
            <div className="admin-fila-nombre">Branding</div>
            <div className="admin-fila-slug">Colores, imágenes y sellos</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="admin-fila" href="/comercio/reglas">
          <div>
            <div className="admin-fila-nombre">Reglas de puntos</div>
            <div className="admin-fila-slug">Cómo se ganan los puntos/sellos</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
        <Link className="admin-fila" href="/comercio/recompensas">
          <div>
            <div className="admin-fila-nombre">Recompensas</div>
            <div className="admin-fila-slug">Catálogo de premios canjeables</div>
          </div>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </main>
  );
}
