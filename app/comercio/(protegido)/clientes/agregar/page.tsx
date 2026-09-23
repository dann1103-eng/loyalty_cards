import Link from 'next/link';
import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';
import { createServiceClient } from '@/lib/supabase/server';
import { listarProgramas } from '@/lib/comercio/programas';
import { leerReglaDeMonto } from '@/lib/comercio/montoAcreditacion';
import { tipoOPuntos, formatearCentavos, aplicaReglaDeMonto } from '@/lib/tarjetas/tipos';
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
  // con `aplicaReglaDeMonto` del programa elegido. Si NINGÚN elegible pasa `aplicaReglaDeMonto`
  // (comercio de prepago, gift card o cashback nomás) la regla no puede gatear nada acá — mismo
  // criterio de "consulta de más" que altaPorTelefono.ts.
  let exigirMontoCompra = false;
  let montoMinimoTexto: string | null = null;
  if (elegibles.some((p) => aplicaReglaDeMonto(p.tipoTarjeta))) {
    const regla = await leerReglaDeMonto(supabase, comercioId);
    const minimo = regla?.minimoCentavos ?? null;
    // Si la lectura falla, se DEGRADA hacia MOSTRAR el campo en vez de esconderlo. No es solo para
    // no dejar al cajero sin pista: la falla puede ser TRANSITORIA (esta lectura, al cargar la
    // página, se cae; pero la misma lectura dentro de altaYAcreditacionPorTelefono, al enviar el
    // formulario segundos después, sí anda). Si acá se escondiera el campo y el envío SÍ pudiera
    // leer la regla y la encontrara activa, el cajero se toparía con "Escribí el monto de la
    // compra" sin ningún campo en pantalla donde escribirlo — un rechazo sin salida. Mostrarlo de
    // más solo cuesta un campo visible en un comercio sin la regla encendida.
    exigirMontoCompra = regla === null ? true : regla.exigir || minimo !== null;
    montoMinimoTexto = minimo !== null ? formatearCentavos(minimo) : null;
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
