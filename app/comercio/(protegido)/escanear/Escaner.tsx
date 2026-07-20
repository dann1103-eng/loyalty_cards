'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import jsQR from 'jsqr';
import {
  accionBuscarPorToken,
  accionAcreditar,
  accionCanjear,
  type ResultadoEscaneo,
} from './actions';

type Modo = 'camara' | 'sin-camara' | 'buscando' | 'resultado';

export default function Escaner({ tokenInicial }: { tokenInicial?: string }) {
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
  const [pendiente, iniciarTransicion] = useTransition();

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

  const acreditar = (delta: number) => {
    if (!resultado?.tarjetaId) return;
    setMensaje(null);
    setError(null);
    iniciarTransicion(async () => {
      const res = await accionAcreditar(resultado.tarjetaId!, delta);
      if (res.ok) {
        setSaldoTexto(res.saldoTexto);
        setResultado((r) => (r ? { ...r, puntosActuales: res.puntosActuales } : r));
        setMensaje(res.mensaje);
      } else {
        setError(res.error);
      }
    });
  };

  const canjear = (recompensaId: string, nombre: string) => {
    if (!resultado?.tarjetaId) return;
    if (!window.confirm(`¿Canjear "${nombre}"? Se descontará del saldo del cliente.`)) return;
    setMensaje(null);
    setError(null);
    iniciarTransicion(async () => {
      const res = await accionCanjear(resultado.tarjetaId!, recompensaId);
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

      {/* Recompensas canjeables */}
      {(resultado.recompensas ?? []).length > 0 && (
        <section style={{ marginTop: 18 }}>
          <p className="titulo-seccion" style={{ marginBottom: 10 }}>Canjear recompensa</p>
          <div className="admin-lista">
            {resultado.recompensas!.map((r) => {
              const alcanza = puntos >= r.costoPuntos;
              return (
                <div key={r.id} className="admin-fila">
                  <div>
                    <div className="admin-fila-nombre">{r.nombre}</div>
                    <div className="admin-fila-slug">
                      <span className="dato-mono">{r.costoPuntos}</span> {resultado.esSellos ? 'sellos' : 'puntos'}
                      {!alcanza && ` · le faltan ${r.costoPuntos - puntos}`}
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
