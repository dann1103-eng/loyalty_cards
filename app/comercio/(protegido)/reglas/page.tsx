import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { TIPOS_REGLA } from '@/lib/comercio/reglas';
import FormularioRegla from './FormularioRegla';
import FormularioControles from './FormularioControles';
import FormularioAvisoInactividad from './FormularioAvisoInactividad';
import BotonEliminarRegla from './BotonEliminarRegla';
import AvisoComercioActivo from '../AvisoComercioActivo';
import { leerControles } from '@/lib/comercio/controlesAcreditacion';
import { leerConfiguracionAvisoInactividad } from '@/lib/comercio/avisoInactividad';
import { listarProgramas } from '@/lib/comercio/programas';
import { unidadPrograma } from '@/lib/tarjetas/unidadPrograma';

export const dynamic = 'force-dynamic';

export default async function PaginaReglas() {
  const { comercioId } = await verifyComercioOwner();

  const supabase = createServiceClient();
  const { data: reglas, error } = await supabase
    .from('reglas_puntos')
    .select('id, tipo, valor')
    .eq('comercio_id', comercioId)
    .order('activa_desde', { ascending: false });

  // Los controles antifraude (Tanda 1) viven acá y no en Marca porque son política de acreditación,
  // no imagen — y así no hace falta un sexto destino en la barra, que descentraría el botón de
  // Escanear (ver lib/comercio/navegacion.ts).
  const controles = await leerControles(supabase, comercioId);
  const avisoInactividad = await leerConfiguracionAvisoInactividad(supabase, comercioId);
  // El tipo sale del programa PRINCIPAL, no de comercios.tipo_tarjeta (columna legada desde la
  // 0024). Con la columna vieja, un comercio al que FM le cambió el tipo sin propagarlo veía el
  // formulario antifraude equivocado: los campos de "puntos" en un programa de sellos, o al revés.
  const programas = await listarProgramas(supabase, comercioId);
  const principal = (programas ?? []).find((p) => p.esPrincipal) ?? null;
  const tipoPrincipal = principal?.tipoTarjeta ?? 'puntos';
  const unidad = unidadPrograma(tipoPrincipal);

  if (error) console.error('[comercio] falló la consulta de reglas:', error);

  const etiquetaTipo = (tipo: string) => TIPOS_REGLA.find((t) => t.valor === tipo)?.etiqueta ?? tipo;

  return (
    <main className="admin-main" style={{ maxWidth: 640 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Reglas del programa</h1>
        <Link className="admin-fila-slug" href="/comercio/panel">← Volver</Link>
      </div>

      <AvisoComercioActivo />

      {/* Estas reglas describen cuántos sellos/puntos/visitas gana el cliente, así que SOLO aplican
          a los tipos que cuentan enteros. En una gift card o un cashback lo que sube son centavos
          (y lo define el porcentaje del programa, no esto), y en cupón/membresía/descuento no hay
          contador. Antes el formulario se mostraba igual y lo que se cargaba ahí no lo leía nadie:
          el reverso del pase ya no imprime esas líneas para esos tipos. */}
      {unidad ? (
        <div className="reveal d2">
          <FormularioRegla unidad={unidad} />
        </div>
      ) : (
        <p className="admin-vacio">
          Tu tarjeta no se gana con sellos ni con puntos, así que no necesita estas reglas. Lo que
          define cuánto gana tu cliente está en{' '}
          <Link href="/comercio/programas">Programas de tarjeta</Link>.
        </p>
      )}

      {/* La configuración por tipo (cashback%, visitas del paquete, …) vivía acá (migración 0018)
          hasta que la 0024 la mudó a cada programa: un comercio puede tener varios tipos a la vez,
          así que ya no tiene sentido una sola configuración a nivel comercio. */}
      <div className="reveal d2" style={{ marginTop: 22 }}>
        <Link className="admin-fila" href="/comercio/programas">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="icono-circulo menta" aria-hidden="true">
              <span className="icono">style</span>
            </span>
            <div>
              <div className="admin-fila-nombre">Programas de tarjeta</div>
              <div className="admin-fila-slug">Tipo, configuración y QR de cada programa</div>
            </div>
          </div>
          <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
        </Link>
      </div>

      <div className="reveal d2" style={{ marginTop: 22 }}>
        {controles ? (
          <FormularioControles
            controles={controles}
            esDePuntos={tipoPrincipal === 'puntos'}
          />
        ) : (
          <p className="admin-error" role="alert">
            No se pudo cargar el control de sellos. Recarga la página.
          </p>
        )}
      </div>

      {avisoInactividad && (
        <div className="reveal d2" style={{ marginTop: 22 }}>
          <FormularioAvisoInactividad configuracion={avisoInactividad} />
        </div>
      )}

      <div className="admin-lista reveal d3" style={{ marginTop: 22 }}>
        {error ? (
          <p className="admin-error" role="alert">No se pudieron cargar las reglas. Recarga la página.</p>
        ) : !reglas || reglas.length === 0 ? (
          <p className="admin-vacio">Todavía no hay reglas. Agrega la primera.</p>
        ) : (
          reglas.map((r) => (
            <div key={r.id} className="admin-fila">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span className="icono-circulo menta" aria-hidden="true">
                  <span className="icono">{r.tipo === 'por_monto' ? 'payments' : 'storefront'}</span>
                </span>
                <div>
                  <div className="admin-fila-nombre">{etiquetaTipo(r.tipo)}</div>
                  <div className="admin-fila-slug">
                    Valor: <span className="dato-mono">{r.valor}</span>
                  </div>
                </div>
              </div>
              <BotonEliminarRegla id={r.id} />
            </div>
          ))
        )}
      </div>
    </main>
  );
}
