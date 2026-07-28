'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import jsQR from 'jsqr';
import {
  accionBuscarPorToken,
  accionAcreditar,
  accionAcreditarForzado,
  accionQuitar,
  accionCanjear,
  type ResultadoEscaneo,
} from './actions';
import { LARGO_MAXIMO_MOTIVO } from '@/lib/comercio/motivo';

type Modo = 'camara' | 'sin-camara' | 'buscando' | 'resultado';

// Sucursal a la que se atribuye la operación. Un CAJERO recibe una fija (su membresía); un OWNER
// recibe la lista de activas para elegir en un picker. La atribución real la decide el servidor
// (resolverSucursalDeAccion): para el cajero el valor que mande este cliente se ignora.
export type SucursalOpcion = { id: string; nombre: string };

// Lo que quedó bloqueado por una perilla antifraude y espera autorización del dueño. Se guarda el
// `delta` con el que se INTENTÓ acreditar, no se recalcula desde el input al autorizar: entre el
// bloqueo y la autorización el cajero pudo tocar el campo, y se estaría autorizando otra cosa.
type Bloqueo = { mensaje: string; delta: number; monto: number | null };

export default function Escaner({
  tokenInicial,
  sucursalFija,
  sucursales,
  sucursalInicialId,
  puedeForzar = false,
}: {
  tokenInicial?: string;
  sucursalFija?: SucursalOpcion;
  sucursales?: SucursalOpcion[];
  sucursalInicialId?: string;
  puedeForzar?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [modo, setModo] = useState<Modo>(tokenInicial ? 'buscando' : 'camara');
  const [resultado, setResultado] = useState<ResultadoEscaneo | null>(null);
  const [saldoTexto, setSaldoTexto] = useState<string>('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deltaPuntos, setDeltaPuntos] = useState('1');
  const [tokenManual, setTokenManual] = useState('');
  // Solo aplica al owner (con picker). Arranca en la sucursal activa del contexto si hay una
  // (plan 2026-07-25 §4.5) — editable por operación; '' = "Sin especificar" → null.
  const [sucursalIdSeleccionada, setSucursalIdSeleccionada] = useState(sucursalInicialId ?? '');
  // Antifraude (Tanda 1): monto de la compra, acreditación bloqueada por una perilla, y corrección.
  const [montoCompra, setMontoCompra] = useState('');
  const [bloqueo, setBloqueo] = useState<Bloqueo | null>(null);
  const [motivoForzado, setMotivoForzado] = useState('');
  const [mostrarCorregir, setMostrarCorregir] = useState(false);
  const [cantidadQuitar, setCantidadQuitar] = useState('1');
  const [motivoQuitar, setMotivoQuitar] = useState('');
  const [pendiente, iniciarTransicion] = useTransition();

  // Valor que se manda a las acciones como "sucursal del cliente". Para el cajero es su sucursal fija
  // (el servidor la revalida igual); para el owner, lo elegido en el picker ('' → null).
  const sucursalIdCliente = sucursalFija ? sucursalFija.id : sucursalIdSeleccionada || null;

  const apagarCamara = useCallback(() => {
    if (intervaloRef.current) {
      clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const consultar = useCallback(
    (token: string) => {
      apagarCamara();
      setModo('buscando');
      setMensaje(null);
      setError(null);
      iniciarTransicion(async () => {
        const res = await accionBuscarPorToken(token);
        setResultado(res);
        setSaldoTexto(res.saldoTexto ?? '');
        setModo('resultado');
      });
    },
    [apagarCamara],
  );

  // Cámara + loop de decodificación (jsQR sobre un canvas). Se enciende solo en modo 'camara'.
  useEffect(() => {
    if (modo !== 'camara') return;
    let cancelado = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        intervaloRef.current = setInterval(() => {
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0);
          const imagen = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(imagen.data, imagen.width, imagen.height);
          if (qr?.data) consultar(qr.data);
        }, 300);
      } catch (e) {
        // Sin permiso o sin cámara: entrada manual del código (el mismo token que muestra
        // /comercio/clientes bajo cada QR).
        console.warn('[escaner] no se pudo abrir la cámara:', e);
        if (!cancelado) setModo('sin-camara');
      }
    })();

    return () => {
      cancelado = true;
      apagarCamara();
    };
  }, [modo, consultar, apagarCamara]);

  // Consulta directa cuando se llega con ?token= (desde el directorio de clientes). El estado
  // inicial ya es 'buscando' en ese caso, así que aquí solo corre la transición async (sin
  // setState síncrono en el efecto — regla react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!tokenInicial) return;
    iniciarTransicion(async () => {
      const res = await accionBuscarPorToken(tokenInicial);
      setResultado(res);
      setSaldoTexto(res.saldoTexto ?? '');
      setModo('resultado');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  // Monto tecleado por el cajero, o null si el comercio no lo pide (o lo dejó vacío).
  const montoNumerico = () => {
    if (!resultado?.pedirMontoCompra) return null;
    const n = Number(montoCompra.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const aplicarExito = (res: { puntosActuales: number; saldoTexto: string; mensaje: string }) => {
    setSaldoTexto(res.saldoTexto);
    setResultado((r) => (r ? { ...r, puntosActuales: res.puntosActuales } : r));
    setMensaje(res.mensaje);
    setBloqueo(null);
    setMotivoForzado('');
    setMostrarCorregir(false);
    setMotivoQuitar('');
    setMontoCompra('');
  };

  const acreditar = (delta: number) => {
    if (!resultado?.tarjetaId) return;
    const monto = montoNumerico();
    setMensaje(null);
    setError(null);
    setBloqueo(null);
    iniciarTransicion(async () => {
      const res = await accionAcreditar(resultado.tarjetaId!, delta, sucursalIdCliente, monto);
      if (res.ok) {
        aplicarExito(res);
      } else if (res.bloqueoLimite) {
        // No es un fallo: es una perilla del dueño haciendo su trabajo. Se guarda el intento para
        // que él pueda autorizarlo sin que el cajero tenga que volver a teclear nada.
        setBloqueo({ mensaje: res.error, delta, monto });
      } else {
        setError(res.error);
      }
    });
  };

  const autorizar = () => {
    if (!resultado?.tarjetaId || !bloqueo) return;
    setError(null);
    iniciarTransicion(async () => {
      const res = await accionAcreditarForzado(
        resultado.tarjetaId!,
        bloqueo.delta,
        motivoForzado,
        sucursalIdCliente,
        bloqueo.monto,
      );
      if (res.ok) aplicarExito(res);
      else setError(res.error);
    });
  };

  const quitar = () => {
    if (!resultado?.tarjetaId) return;
    const cantidad = Math.max(1, Math.floor(Number(cantidadQuitar) || 1));
    setMensaje(null);
    setError(null);
    iniciarTransicion(async () => {
      const res = await accionQuitar(resultado.tarjetaId!, cantidad, motivoQuitar, sucursalIdCliente);
      if (res.ok) aplicarExito(res);
      else setError(res.error);
    });
  };

  const canjear = (recompensaId: string, nombre: string) => {
    if (!resultado?.tarjetaId) return;
    if (!window.confirm(`¿Canjear "${nombre}"? Se descontará del saldo del cliente.`)) return;
    setMensaje(null);
    setError(null);
    iniciarTransicion(async () => {
      const res = await accionCanjear(resultado.tarjetaId!, recompensaId, sucursalIdCliente);
      if (res.ok) {
        setSaldoTexto(res.saldoTexto);
        setResultado((r) => (r ? { ...r, puntosActuales: res.puntosActuales } : r));
        setMensaje(res.mensaje);
      } else {
        setError(res.error);
      }
    });
  };

  const reiniciar = () => {
    setResultado(null);
    setMensaje(null);
    setError(null);
    // Un bloqueo pendiente NO puede sobrevivir al cambio de cliente: autorizarlo después de
    // escanear a otra persona acreditaría al cliente equivocado.
    setBloqueo(null);
    setMotivoForzado('');
    setMostrarCorregir(false);
    setMotivoQuitar('');
    setMontoCompra('');
    setModo('camara');
  };

  /* ---------- vista: cámara ---------- */
  if (modo === 'camara' || modo === 'buscando') {
    return (
      <div className="escaner-marco reveal d2">
        <video ref={videoRef} className="escaner-video" playsInline muted />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className="escaner-guia" aria-hidden="true" />
        <p className="nota" style={{ padding: '0 16px 16px' }}>
          {modo === 'buscando' ? 'Consultando…' : 'Apuntá al QR del pass del cliente (o a su QR impreso).'}
        </p>
      </div>
    );
  }

  /* ---------- vista: sin cámara (entrada manual) ---------- */
  if (modo === 'sin-camara') {
    return (
      <form
        className="panel reveal d2"
        style={{ marginTop: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (tokenManual.trim()) consultar(tokenManual);
        }}
      >
        <p className="alerta" role="alert">
          No se pudo abrir la cámara. Pegá el código de la tarjeta (aparece bajo el QR en Clientes).
        </p>
        <div className="field">
          <label htmlFor="token">Código de la tarjeta</label>
          <input
            id="token"
            value={tokenManual}
            onChange={(e) => setTokenManual(e.target.value)}
            className="dato-mono"
            placeholder="a1b2c3…"
            required
          />
        </div>
        <button className="btn-primary" type="submit" disabled={pendiente}>
          {pendiente ? 'Consultando…' : 'Consultar'}
        </button>
      </form>
    );
  }

  /* ---------- vista: resultado ---------- */
  if (!resultado?.encontrado) {
    return (
      <div className="panel reveal d1" style={{ marginTop: 0, textAlign: 'center' }}>
        <p className="alerta" role="alert" style={{ justifyContent: 'center' }}>
          Ese QR no corresponde a una tarjeta de tu comercio.
        </p>
        <button className="btn-borde" style={{ marginTop: 14 }} onClick={reiniciar}>
          Escanear de nuevo
        </button>
      </div>
    );
  }

  const puntos = resultado.puntosActuales ?? 0;

  return (
    <div className="reveal d1">
      {/* Cliente + saldo */}
      <section className="panel" style={{ marginTop: 0, textAlign: 'center' }}>
        <span className="icono-circulo menta" style={{ margin: '0 auto 10px' }} aria-hidden="true">
          <span className="icono">person</span>
        </span>
        <h2 className="admin-fila-nombre" style={{ fontSize: '1.2rem' }}>{resultado.nombreCliente}</h2>
        {resultado.telefono && <p className="admin-fila-slug dato-mono">{resultado.telefono}</p>}
        <p className="metric-valor" style={{ fontSize: '2rem', marginTop: 12, color: 'var(--acento)' }}>
          {saldoTexto}
        </p>

        {/* Atribución de sucursal: fija para el cajero (solo etiqueta), elegible para el owner. */}
        {sucursalFija && (
          <p className="nota" style={{ marginTop: 12 }}>
            Sucursal: <strong style={{ color: 'var(--texto)' }}>{sucursalFija.nombre}</strong>
          </p>
        )}
        {sucursales && (
          <div className="field" style={{ marginTop: 12, textAlign: 'left' }}>
            <label htmlFor="sucursal-escaner">Sucursal</label>
            <select
              id="sucursal-escaner"
              value={sucursalIdSeleccionada}
              onChange={(e) => setSucursalIdSeleccionada(e.target.value)}
            >
              <option value="">Sin especificar</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Monto de la compra: solo si el dueño lo activó. Es lo que después deja comparar cuánto
            se vendió contra cuántos sellos se dieron, por cajero. */}
        {resultado.pedirMontoCompra && (
          <div className="field" style={{ marginTop: 14, textAlign: 'left' }}>
            <label htmlFor="monto-compra">Monto de la compra (opcional)</label>
            <input
              id="monto-compra"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              placeholder="0.00"
              value={montoCompra}
              onChange={(e) => setMontoCompra(e.target.value)}
            />
          </div>
        )}

        {resultado.esSellos ? (
          <button className="btn-acento" style={{ marginTop: 16 }} onClick={() => acreditar(1)} disabled={pendiente}>
            <span className="icono" aria-hidden="true">add_circle</span>
            {pendiente ? 'Guardando…' : '+1 sello'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'stretch' }}>
            <input
              aria-label="Puntos a sumar"
              type="number"
              min="1"
              step="1"
              value={deltaPuntos}
              onChange={(e) => setDeltaPuntos(e.target.value)}
              className="dato-mono"
              style={{
                width: 90,
                background: 'var(--superficie-1)',
                border: '1px solid var(--linea)',
                borderRadius: 12,
                color: 'var(--texto)',
                padding: '0 12px',
                fontSize: '1rem',
              }}
            />
            <button
              className="btn-acento"
              style={{ flex: 1 }}
              onClick={() => acreditar(Math.max(1, Math.floor(Number(deltaPuntos) || 1)))}
              disabled={pendiente}
            >
              {pendiente ? 'Guardando…' : 'Sumar puntos'}
            </button>
          </div>
        )}

        {mensaje && <p className="nota" style={{ color: 'var(--menta)' }}>{mensaje} El pass del cliente se actualiza solo.</p>}
        {error && <p className="alerta" role="alert">{error}</p>}
      </section>

      {/* Bloqueo por una perilla antifraude. No se muestra como error rojo: no falló nada, es una
          regla del dueño. Al cajero se le dice a quién pedirle; al dueño se le da el formulario. */}
      {bloqueo && (
        <section className="panel" style={{ marginTop: 18, borderColor: 'var(--acento)' }}>
          <p className="alerta" role="alert" style={{ marginTop: 0 }}>{bloqueo.mensaje}</p>
          {puedeForzar ? (
            <>
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="motivo-forzado">
                  Motivo de la autorización (queda en el historial del cliente)
                </label>
                <textarea
                  id="motivo-forzado"
                  rows={2}
                  maxLength={LARGO_MAXIMO_MOTIVO}
                  placeholder="Ej.: compró en la mañana y volvió en la tarde"
                  value={motivoForzado}
                  onChange={(e) => setMotivoForzado(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className="btn-acento"
                  style={{ flex: 1 }}
                  onClick={autorizar}
                  disabled={pendiente || !motivoForzado.trim()}
                >
                  {pendiente ? 'Autorizando…' : `Autorizar y acreditar ${bloqueo.delta}`}
                </button>
                <button className="btn-borde" onClick={() => setBloqueo(null)} disabled={pendiente}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <p className="nota" style={{ marginBottom: 0 }}>
              Pedile al dueño que lo autorice desde su cuenta.
            </p>
          )}
        </section>
      )}

      {/* Corrección: disponible para el cajero TAMBIÉN, para que pueda arreglar su propio error en
          el momento. Queda auditado con su nombre, su hora y su motivo. Solo resta: sumar de más
          sería una puerta trasera al tope diario. */}
      <section style={{ marginTop: 18 }}>
        {!mostrarCorregir ? (
          <button className="btn-borde" style={{ width: '100%' }} onClick={() => setMostrarCorregir(true)}>
            <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">undo</span>
            Corregir: quitar {resultado.esSellos ? 'sellos' : 'puntos'}
          </button>
        ) : (
          <div className="panel" style={{ marginTop: 0 }}>
            <p className="titulo-seccion" style={{ marginTop: 0 }}>
              Quitar {resultado.esSellos ? 'sellos' : 'puntos'}
            </p>
            <div className="field">
              <label htmlFor="cantidad-quitar">Cuántos quitar</label>
              <input
                id="cantidad-quitar"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={cantidadQuitar}
                onChange={(e) => setCantidadQuitar(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="motivo-quitar">Motivo (obligatorio)</label>
              <textarea
                id="motivo-quitar"
                rows={2}
                maxLength={LARGO_MAXIMO_MOTIVO}
                placeholder="Ej.: puse 4 sellos y era 1"
                value={motivoQuitar}
                onChange={(e) => setMotivoQuitar(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn-acento"
                style={{ flex: 1 }}
                onClick={quitar}
                disabled={pendiente || !motivoQuitar.trim()}
              >
                {pendiente ? 'Quitando…' : 'Quitar'}
              </button>
              <button
                className="btn-borde"
                onClick={() => {
                  setMostrarCorregir(false);
                  setMotivoQuitar('');
                }}
                disabled={pendiente}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Recompensas canjeables */}
      {(resultado.recompensas ?? []).length > 0 && (
        <section style={{ marginTop: 18 }}>
          <p className="titulo-seccion" style={{ marginBottom: 10 }}>Canjear recompensa</p>
          <div className="admin-lista">
            {resultado.recompensas!.map((r) => {
              const alcanza = puntos >= r.costoPuntos;
              return (
                <div key={r.id} className="admin-fila">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    {/* La foto del premio le deja al cajero identificar qué entregar sin leer el
                        nombre. Se usa <img> y no next/image a propósito: la URL viene del bucket de
                        Supabase y next/image exigiría declarar el dominio en next.config, sin
                        ninguna ganancia acá (son miniaturas de 48 px). */}
                    {r.fotoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- URL pública del bucket
                      <img
                        src={r.fotoUrl}
                        alt=""
                        width={48}
                        height={48}
                        style={{
                          width: 48,
                          height: 48,
                          objectFit: 'cover',
                          borderRadius: 10,
                          flexShrink: 0,
                          border: '1px solid var(--linea)',
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0 }}>
                    <div className="admin-fila-nombre">{r.nombre}</div>
                    <div className="admin-fila-slug">
                      <span className="dato-mono">{r.costoPuntos}</span> {resultado.esSellos ? 'sellos' : 'puntos'}
                      {!alcanza && ` · le faltan ${r.costoPuntos - puntos}`}
                    </div>
                    </div>
                  </div>
                  <button
                    className="btn-borde"
                    onClick={() => canjear(r.id, r.nombre)}
                    disabled={pendiente || !alcanza}
                    style={!alcanza ? { opacity: 0.45 } : undefined}
                  >
                    Canjear
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <button className="btn-borde" style={{ marginTop: 18, width: '100%' }} onClick={reiniciar}>
        <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">qr_code_scanner</span>
        Escanear otra tarjeta
      </button>
    </div>
  );
}
