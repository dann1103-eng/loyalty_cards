import Link from 'next/link';
import { verifyComercioOwner } from '@/lib/comercio/verifyComercioOwner';
import { confirmarRetornoDelDueno } from '@/lib/comercios/confirmarRetornoSupabase';
import type { ResultadoRetorno } from '@/lib/comercios/confirmarPorRedirect';
import { cuentaDelComercio } from '../../actions';
import RecargarSola from './RecargarSola';

export const dynamic = 'force-dynamic';

// Adonde Wompi devuelve al dueño después de pagar (`urlRedirect` del enlace). Es el camino de RESPALDO
// del webhook: como el plan solo cambia al confirmarse el pago, el dueño no puede quedar esperando. La
// confirmación en sí vive en lib/comercios/confirmarPorRedirect.ts; esta página solo la llama y la dibuja.
//
// La URL trae parámetros de Wompi, pero NO son de fiar por sí solos (cualquiera puede escribir una URL):
// la verdad es la consulta a la API de Wompi, y el cobro tiene que ser de la cuenta de la SESIÓN.
//
// Recargarla es seguro: la confirmación es idempotente.

type Parametros = Record<string, string | string[] | undefined>;

const uno = (valor: string | string[] | undefined): string | null => (typeof valor === 'string' ? valor : null);

const MENSAJES: Record<Exclude<ResultadoRetorno['estado'], 'confirmando'>, { titulo: string; texto: string; acento?: boolean }> = {
  confirmado: {
    titulo: 'Pago confirmado',
    texto: 'Recibimos tu pago y tu plan ya está al día. Gracias.',
    acento: true,
  },
  prueba: {
    titulo: 'Pago de prueba',
    texto: 'Este fue un pago de prueba: no cambia tu plan ni se cobró plata.',
  },
  rechazado: {
    titulo: 'Wompi no aprobó el pago',
    texto: 'No se te cobró nada. Podés volver a intentarlo, con la misma tarjeta o con otra.',
  },
  revision: {
    titulo: 'Recibimos tu pago',
    texto: 'Hay algo que tenemos que revisar a mano antes de aplicarlo. No pagues de nuevo: te escribimos apenas lo veamos.',
  },
  invalido: {
    titulo: 'No encontramos ese pago',
    texto: 'El enlace no corresponde a un pago de tu cuenta. Si acabás de pagar, mirá tus cobros en Mi plan.',
  },
};

export default async function PaginaResultadoPago({ searchParams }: { searchParams: Promise<Parametros> }) {
  const { comercioId } = await verifyComercioOwner();
  const cuentaId = await cuentaDelComercio(comercioId);
  const params = await searchParams;

  const resultado: ResultadoRetorno = cuentaId
    ? await confirmarRetornoDelDueno(cuentaId, {
        identificadorEnlaceComercio: uno(params.identificadorEnlaceComercio),
        idTransaccion: uno(params.idTransaccion),
        idEnlace: uno(params.idEnlace),
        monto: uno(params.monto),
        hash: uno(params.hash),
      })
    : { estado: 'invalido' };

  const mensaje = resultado.estado === 'confirmando' ? null : MENSAJES[resultado.estado];

  return (
    <main className="admin-main" style={{ maxWidth: 560 }}>
      <div className="admin-encabezado reveal d1">
        <h1 className="title" style={{ margin: 0 }}>Tu pago</h1>
      </div>

      <section className="panel reveal d2" style={{ marginTop: 0 }}>
        {mensaje ? (
          <>
            <p
              className="metric-valor"
              style={{ fontSize: '1.4rem', marginTop: 0, color: mensaje.acento ? 'var(--acento)' : undefined }}
            >
              {mensaje.titulo}
            </p>
            <p className="admin-fila-slug">{mensaje.texto}</p>
          </>
        ) : (
          <>
            <p className="metric-valor" style={{ fontSize: '1.4rem', marginTop: 0 }}>Estamos confirmando tu pago</p>
            <p className="admin-fila-slug">
              Wompi todavía no nos avisó. Esta página se actualiza sola: no la cierres ni pagues de nuevo.
            </p>
            <RecargarSola />
          </>
        )}
        <div style={{ marginTop: 16 }}>
          <Link className="btn-borde" href="/comercio/plan">
            Volver a Mi plan
          </Link>
        </div>
      </section>
    </main>
  );
}
