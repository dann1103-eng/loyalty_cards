'use client';

import { useState, type FormEvent } from 'react';
import type { ResultadoConsulta, TarjetaPortal } from '@/lib/portal/buscarTarjetas';

function CaraTarjeta({ tarjeta }: { tarjeta: TarjetaPortal }) {
  // Usa los colores reales del comercio (como el pass). Fallback al fondo oscuro del sistema v2
  // si el comercio no tiene colores cargados. (Adaptado del plan original, escrito para el sistema
  // café: la estructura de .cardface cambió con el rediseño Stitch.)
  const fondo = tarjeta.colorFondo ?? '#131315';
  const texto = tarjeta.colorTexto ?? '#f5f5f0';
  const label = tarjeta.colorLabel ?? undefined;
  return (
    <div className="cardface" style={{ background: fondo, color: texto }}>
      <div className="cardface-top" style={label ? { color: label } : undefined}>
        <span>Tarjeta de lealtad</span>
        <span>FM Lealtad</span>
      </div>
      <div className="cardface-name">{tarjeta.comercioNombre}</div>
      <div className="portal-saldo">{tarjeta.saldoTexto}</div>
    </div>
  );
}

function DetalleTarjeta({ tarjeta }: { tarjeta: TarjetaPortal }) {
  return (
    <div className="portal-detalle">
      <CaraTarjeta tarjeta={tarjeta} />

      {tarjeta.recompensas.length > 0 && (
        <div className="portal-recompensas">
          <p className="portal-subtitulo">Recompensas</p>
          {tarjeta.recompensas.map((r, i) => {
            const falta = r.costoPuntos - tarjeta.puntosActuales;
            return (
              <div className="portal-recompensa" key={`${r.nombre}-${i}`}>
                <div>
                  <div className="portal-recompensa-nombre">{r.nombre}</div>
                  {r.descripcion && <div className="portal-recompensa-desc">{r.descripcion}</div>}
                </div>
                <div className="portal-recompensa-estado">
                  {falta <= 0 ? (
                    <span className="portal-canjeable">Ya puedes canjearla</span>
                  ) : (
                    <span className="portal-falta">Te faltan {falta}</span>
                  )}
                  <span className="portal-costo">{r.costoPuntos} pts</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reusa el endpoint de descarga existente (mismo patrón que RegistroCliente). */}
      <a className="wallet-btn" href={`/api/tarjetas/${tarjeta.tarjetaId}/pass.pkpass`}>
        Descargar mi pass de nuevo
      </a>
      <p className="nota">
        El canje se hace en el local: muestra tu pass al cajero. Esta vista es solo para consultar.
      </p>
    </div>
  );
}

export default function PortalCliente() {
  const [telefono, setTelefono] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoConsulta | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    setResultado(null);
    setSeleccion(null);
    try {
      const res = await fetch('/api/portal/consulta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefono }),
      });
      const data = await res.json();
      if (res.status === 429) {
        setError('Demasiados intentos. Espera unos minutos e inténtalo de nuevo.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'No se pudo consultar. Intenta de nuevo.');
        return;
      }
      setResultado(data);
      // Si solo hay una tarjeta, se muestra directo (sin selector).
      if (data.encontrado && data.tarjetas.length === 1) {
        setSeleccion(data.tarjetas[0].tarjetaId);
      }
    } catch {
      setError('No se pudo conectar. Revisa tu internet e intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }

  function reiniciar() {
    setResultado(null);
    setSeleccion(null);
    setError(null);
  }

  if (resultado?.encontrado) {
    const tarjetas = resultado.tarjetas;
    const activa = tarjetas.find((t) => t.tarjetaId === seleccion) ?? null;
    return (
      <main className="shell">
        <div className="stack">
          <h1 className="title reveal d1" style={{ fontSize: '2rem' }}>
            Hola, {resultado.nombreCliente}
          </h1>

          {tarjetas.length === 0 ? (
            <p className="lede reveal d2">Aún no tienes tarjetas registradas.</p>
          ) : (
            <>
              {tarjetas.length > 1 && (
                <div className="portal-cuentas reveal d2">
                  {tarjetas.map((t) => (
                    <button
                      key={t.tarjetaId}
                      type="button"
                      className={`portal-cuenta ${t.tarjetaId === seleccion ? 'portal-cuenta-activa' : ''}`}
                      onClick={() => setSeleccion(t.tarjetaId)}
                    >
                      <span className="portal-cuenta-nombre">{t.comercioNombre}</span>
                      <span className="portal-cuenta-saldo">{t.saldoTexto}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="reveal d3">{activa && <DetalleTarjeta tarjeta={activa} />}</div>
            </>
          )}

          <button type="button" className="portal-link" onClick={reiniciar}>
            Consultar otro número
          </button>

          <div className="portal-instalar">
            <p className="portal-subtitulo">Tenla siempre a mano</p>
            <p className="nota">
              En iPhone: toca el botón <b>Compartir</b> de Safari y elige <b>Agregar a inicio</b>.
              (Safari no lo ofrece solo — hay que hacerlo desde ese menú.) En Android/Chrome, el
              navegador puede ofrecerte <b>Agregar a pantalla de inicio</b>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">FM Lealtad</p>
        <h1 className="title reveal d2">Mi tarjeta</h1>
        <p className="lede reveal d2">
          Ingresa tu teléfono para ver tus puntos, tus sellos y las recompensas que puedes canjear.
        </p>

        <form className="panel reveal d3" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="telefono">Teléfono</label>
            <input
              id="telefono"
              type="tel"
              inputMode="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="7777 1234"
              autoComplete="tel"
              required
            />
          </div>
          <button className="btn-primary" type="submit" disabled={cargando}>
            {cargando ? 'Consultando…' : 'Ver mi tarjeta'}
          </button>
          {error && (
            <p className="alerta" role="alert">
              {error}
            </p>
          )}
          {resultado && !resultado.encontrado && !error && (
            <p className="alerta" role="alert">
              No encontramos una tarjeta con ese número. Revisa que sea el mismo con el que te
              registraste.
            </p>
          )}
          <p className="nota">Solo usamos tu teléfono para encontrar tu tarjeta.</p>
        </form>
      </div>
    </main>
  );
}
