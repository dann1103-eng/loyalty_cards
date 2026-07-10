'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';

export default function PaginaRegistro() {
  const { comercioSlug } = useParams<{ comercioSlug: string }>();
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
      <main>
        <h1>¡Listo!</h1>
        <a href={`/api/tarjetas/${tarjetaId}/pass.pkpass`}>Agregar a Apple Wallet</a>
      </main>
    );
  }

  return (
    <main>
      <h1>Regístrate</h1>
      <form onSubmit={handleSubmit}>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" required />
        <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Teléfono" required />
        <button type="submit" disabled={cargando}>{cargando ? 'Enviando...' : 'Registrarme'}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
