'use client';

import { useState } from 'react';
import { botonesWallet, type Plataforma } from '@/lib/clientes/plataforma';

// Los íconos vivían en RegistroCliente.tsx; se mudan acá porque ahora los dibujan DOS pantallas
// (el registro y, desde la Tarea 2, el portal /mi-tarjeta) y los dos botones son parte de este
// mismo componente.
function IconoWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 9.5h19" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16.5 14.5h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconoGoogle() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.07 5.07 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.85A10.99 10.99 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.85z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a10.99 10.99 0 0 0-9.82 6.05l3.66 2.85C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

// Botones de Wallet según la plataforma detectada (lib/clientes/plataforma.ts), compartido entre la
// pantalla de éxito del registro y "Descargar mi pass de nuevo" del portal /mi-tarjeta (Tarea 2).
//
// `urlGoogle: null` ES la señal de que Google no está disponible para esta tarjeta — no hay una
// prop `googleDisponible` aparte: una sola fuente de verdad evita el caso "googleDisponible: true,
// urlGoogle: null" (un botón que apunta a ningún lado).
//
// La nota de Safari y el link "¿Tienes otro teléfono?" los decide `botonesWallet` (puro, con
// prueba): este componente solo aporta el estado `mostrarOtro` (si el cliente ya tocó el link en
// ESTA pantalla) y el orden/ícono/texto de cada botón, que es puro pegamento con el DOM sin lógica
// que valga la pena extraer (no hay pruebas de componentes en este repo — CLAUDE.md).
export default function BotonesWallet({
  plataforma,
  urlApple,
  urlGoogle,
  textoApple,
  textoGoogle,
}: {
  plataforma: Plataforma;
  urlApple: string;
  urlGoogle: string | null;
  textoApple: string;
  textoGoogle: string;
}) {
  const [mostrarOtro, setMostrarOtro] = useState(false);
  const resultado = botonesWallet({
    plataforma,
    googleDisponible: urlGoogle !== null,
    mostrarOtro,
  });

  // En Android el botón de Google va PRIMERO (es la billetera del cliente); en todo lo demás,
  // Apple sigue primero como siempre. El primero visible lleva el marginTop de siempre (.wallet-btn,
  // 20px); el segundo, si hay dos, lleva el marginTop de 10px que hoy los separaba entre sí.
  const orden: Array<'apple' | 'google'> = plataforma === 'android' ? ['google', 'apple'] : ['apple', 'google'];
  // resultado.google nunca es true sin urlGoogle: se calculó pasándole `urlGoogle !== null` como
  // googleDisponible unas líneas arriba, así que no hace falta repetir el chequeo acá.
  const visibles = orden.filter((id) => (id === 'apple' ? resultado.apple : resultado.google));

  return (
    <>
      {visibles.map((id, i) =>
        id === 'apple' ? (
          <a key="apple" className="wallet-btn" style={i > 0 ? { marginTop: 10 } : undefined} href={urlApple}>
            <IconoWallet />
            {textoApple}
          </a>
        ) : (
          <a
            key="google"
            className="wallet-btn"
            style={i > 0 ? { marginTop: 10 } : undefined}
            href={urlGoogle as string}
          >
            <IconoGoogle />
            {textoGoogle}
          </a>
        ),
      )}
      {resultado.link && (
        // Clase reusada de PortalCliente.tsx (link secundario, subrayado): no hay una clase propia
        // para "revelar otra opción" y esta ya da el estilo correcto sin agregar CSS nuevo.
        <button type="button" className="portal-link" onClick={() => setMostrarOtro(true)}>
          ¿Tienes otro teléfono?
        </button>
      )}
      {resultado.notaSafari && (
        <p className="nota">
          ¿No se abrió? Mantén presionado el botón y elige “Descargar”, o ábrelo desde Safari.
        </p>
      )}
    </>
  );
}
