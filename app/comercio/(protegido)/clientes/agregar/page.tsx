import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas } from '@/lib/comercio/programas';
import { leerReglaDeMonto } from '@/lib/comercio/montoAcreditacion';
import { tipoOPuntos, formatearCentavos } from '@/lib/tarjetas/tipos';
import FormularioAgregarCliente from './FormularioAgregarCliente';

export const dynamic = 'force-dynamic';

// Dar de alta a un cliente que pidió a domicilio: nunca estuvo en el local, así que nadie pudo
// escanearle el QR. Es la v1 del spec de delivery
// (docs/superpowers/specs/2026-08-07-puntos-por-delivery-design.md).
//
// Gate COMPARTIDO: quien atiende el teléfono suele ser el cajero.
export default async function PaginaAgregarCliente() {
  const { comercioId } = await verifyComercioAcceso();
  const supabase = createServiceClient();

  const programas = await listarProgramas(supabase, comercioId);

  // Solo las tarjetas que ACUMULAN. En cupón, membresía y descuento no hay número que sumar —su
  // estado es una fecha o un nivel— así que ofrecerlas acá sería ofrecer una operación que la capa
  // de datos rechaza. Se filtran en el origen en vez de dejar que el dueño elija y se lleve un error.
  const elegibles = (programas ?? [])
    .filter((p) => p.activo && tipoOPuntos(p.tipoTarjeta).contador !== 'ninguno')
    .map((p) => ({ id: p.id, nombre: p.nombre, tipoTarjeta: p.tipoTarjeta }));

  // Regla de monto obligatorio / mínimo de compra del comercio (migración 0039,
  // lib/comercio/montoAcreditacion.ts). Se lee acá (server) y no en el formulario (client component)
  // porque leerReglaDeMonto toca Supabase con el service client. Cuál tarjeta va a elegir el cajero
  // lo decide recién en el navegador, así que se le pasa la regla entera y el formulario la cruza
  // con `aplicaReglaDeMonto` del programa elegido. Si no hay ninguna tarjeta elegible el formulario
  // ni se dibuja: no vale la pena la consulta.
  let exigirMontoCompra = false;
  let montoMinimoTexto: string | null = null;
  if (elegibles.length > 0) {
    const regla = await leerReglaDeMonto(supabase, comercioId);
    // Si la lectura falla, se DEGRADA hacia MOSTRAR el campo (en vez de esconderlo):
    // altaYAcreditacionPorTelefono también falla CERRADO ante la misma falla de lectura ("No se
    // pudo verificar la regla de monto. Probá de nuevo."), así que esconder el campo dejaría al
    // cajero sin ninguna pista de por qué el servidor rechaza el alta.
    exigirMontoCompra = regla === null ? true : regla.exigir || regla.minimoCentavos !== null;
    montoMinimoTexto = regla?.minimoCentavos != null ? formatearCentavos(regla.minimoCentavos) : null;
  }

  return (
    <main className="admin-main" style={{ maxWidth: 560 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Agregar un cliente</h1>
        <Link className="admin-fila-slug" href="/comercio/clientes">← Volver</Link>
      </div>
      <p className="lede reveal d1" style={{ marginTop: 0, fontSize: '0.95rem' }}>
        Para el que te pidió por teléfono, por WhatsApp o a domicilio y no pasó por el local. Le
        creás la tarjeta y le acreditás de una.
      </p>

      <div className="reveal d2" style={{ marginTop: 18 }}>
        {elegibles.length === 0 ? (
          <p className="admin-vacio">
            Ninguna de tus tarjetas acumula sellos, puntos ni visitas, así que no hay nada que
            acreditar desde acá. Un cupón o una membresía se usan con el cliente presente, desde{' '}
            <Link href="/comercio/escanear">Escanear</Link>.
          </p>
        ) : (
          <FormularioAgregarCliente
            programas={elegibles}
            exigirMontoCompra={exigirMontoCompra}
            montoMinimoTexto={montoMinimoTexto}
          />
        )}
      </div>
    </main>
  );
}
