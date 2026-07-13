'use client';

import { useState, type FormEvent } from 'react';

function IconoWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16.5 14.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function VistaTarjeta({ nombreComercio }: { nombreComercio: string }) {
  return (
    <div
      className="cardface"
      style={{
        background:
          'linear-gradient(155deg, #3a2a1e 0%, #241812 55%, #1c120c 100%)',
      }}
    >
      <div className="cardface-top">
        <span>Tarjeta de lealtad</span>
        <span className="cardface-dot">fm</span>
      </div>
      <div className="cardface-name">{nombreComercio}</div>
      <div className="cardface-points">
        <b>0</b>
        <span>Puntos</span>
      </div>
    </div>
  );
}

export default function RegistroCliente({
  comercioSlug,
  nombreComercio,
}: {
  comercioSlug: string;
  nombreComercio: string;
}) {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [tarjetaId, setTarjetaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercioSlug, nombre, telefono }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al registrar');
      setTarjetaId(data.tarjetaId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  if (tarjetaId) {
    return (
      <main className="shell">
        <div className="stack">
          <div className="check reveal d1" aria-hidden="true">✓</div>
          <h1 className="title reveal d2" style={{ marginTop: 18 }}>
            Tu tarjeta está <em>lista</em>
          </h1>
          <p className="lede reveal d2">
            Agrégala a tu Apple Wallet y empieza a sumar puntos en {nombreComercio}.
          </p>
          <div className="panel reveal d3" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, marginTop: 26 }}>
            <VistaTarjeta nombreComercio={nombreComercio} />
            <a className="wallet-btn" href={`/api/tarjetas/${tarjetaId}/pass.pkpass`}>
              <IconoWallet />
              Agregar a Apple Wallet
            </a>
            <p className="nota">
              ¿No se abrió? Mantén presionado el botón y elige “Descargar”, o ábrelo desde Safari.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">Tarjeta de lealtad</p>
        <h1 className="title reveal d2">{nombreComercio}</h1>
        <p className="lede reveal d2">
          Regístrate una vez y suma puntos en cada visita, directo en tu Apple Wallet.
          Sin apps, sin plásticos.
        </p>

        <form className="panel reveal d3" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="nombre">Nombre</label>
            <input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="name"
              required
            />
          </div>
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
            {cargando ? 'Creando tu tarjeta…' : 'Crear mi tarjeta'}
          </button>
          {error && (
            <p className="alerta" role="alert">
              {error}
            </p>
          )}
          <p className="nota">
            Solo usamos tu nombre y teléfono para identificar tu tarjeta.
          </p>
        </form>
      </div>
    </main>
  );
}
