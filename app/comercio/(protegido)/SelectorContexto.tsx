'use client';

import { useEffect, useState, useSyncExternalStore, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { cambiarContextoActivo } from '../actions';

// "¿Ya estamos en el navegador?" sin setState en un effect (esa regla es ERROR en este repo).
// Hace falta porque el sheet se monta con createPortal sobre document.body, que no existe en el
// servidor: en SSR devuelve false y el portal simplemente no se renderiza.
const suscribirNada = () => () => {};
const useEstaEnCliente = () => useSyncExternalStore(suscribirNada, () => true, () => false);

export interface ComercioConSucursales {
  comercioId: string;
  nombre: string;
  sucursales: { id: string; nombre: string; esPrincipal: boolean }[];
}

// Switcher de contexto del header (solo owner): pastilla que dice DÓNDE estás parado + bottom
// sheet para cambiar de comercio/sucursal. La validación real vive en cambiarContextoActivo
// (server) — el cliente nunca es la barrera de seguridad.
export default function SelectorContexto({
  comercios,
  comercioActivoId,
  sucursalActiva,
}: {
  comercios: ComercioConSucursales[];
  comercioActivoId: string;
  sucursalActiva: { id: string; nombre: string } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const enCliente = useEstaEnCliente();

  const activo = comercios.find((c) => c.comercioId === comercioActivoId);
  // La pastilla dice QUÉ REBANADA de datos estás viendo; QUÉ COMERCIO ya lo dice la marca del
  // header, a la izquierda y en tipografía más grande. Repetir el comercio acá lo cortaba a la
  // tercera letra de la sucursal: en un teléfono de 360px la pastilla resuelve en ~104px (la marca
  // no cede ancho por debajo de su min-content) y entran ~12 caracteres — la cuenta completa está
  // en el comentario de .contexto-pastilla en globals.css. 'Todas' y no 'Todas las sucursales' por
  // lo mismo: se abre a una lista de sucursales, el contexto ya lo dice. El texto COMPLETO
  // sobrevive en el aria-label, que es lo que lee un lector de pantalla.
  const etiqueta = sucursalActiva ? sucursalActiva.nombre : 'Todas';
  const etiquetaCompleta = sucursalActiva
    ? `${activo?.nombre ?? ''} · ${sucursalActiva.nombre}`
    : `${activo?.nombre ?? ''} · todas las sucursales`;

  // Escape cierra el sheet. El listener va en `document`, NO un onKeyDown en el panel: al abrir, el
  // foco se queda en la pastilla (FUERA del panel), así que un handler local nunca recibiría la
  // tecla — sería decoración. No lo "simplifiques" moviéndolo al div del panel.
  // Sin esto un usuario de solo-teclado no puede salir: no hay botón de cerrar y el fondo es un div
  // (no activable con teclado), así que la única salida sería activar una fila = cambiar de contexto.
  // (Pendiente, cuando se vuelva a tocar el sheet: migrarlo al <dialog> nativo — trae Escape,
  // trampa de foco e inert del resto de la página, gratis y bien implementados por el navegador.)
  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [abierto]);

  const elegir = (comercioId: string, sucursalId: string | null) => {
    if (comercioId === comercioActivoId && (sucursalId ?? null) === (sucursalActiva?.id ?? null)) {
      setAbierto(false); // sin cambio: no re-dispares la acción
      return;
    }
    startTransition(async () => {
      await cambiarContextoActivo(comercioId, sucursalId);
      // Cambio solo de sucursal: no hay redirect, cerramos acá (con redirect esto no llega a correr).
      setAbierto(false);
    });
  };

  return (
    <>
      <button
        type="button"
        className="contexto-pastilla"
        onClick={() => setAbierto(true)}
        disabled={pendiente}
        aria-label={`Contexto activo: ${etiquetaCompleta}. Cambiar de comercio o sucursal.`}
      >
        <span className="icono" aria-hidden="true" style={{ fontSize: 16 }}>swap_horiz</span>
        <span className="contexto-etiqueta">{etiqueta}</span>
      </button>

      {/* PORTAL A document.body, NO lo saques: el sheet es position:fixed y se ancla al viewport
          SOLO si ningún ancestro crea un containing block. Este vive dentro de .admin-top, que
          tiene `backdrop-filter` para el efecto vidrio — y backdrop-filter (igual que transform o
          filter) convierte al elemento en el marco de referencia de sus descendientes fixed. Sin el
          portal, el panel se dibujaba pegado al header en vez de subir desde abajo, cortado y sin
          scroll (reportado en producción el 2026-07-26). El mismo bug tenía el modal de Sucursales,
          ahí por el transform que deja la animación .reveal al terminar con `forwards`. */}
      {abierto && enCliente && createPortal(
        <div className="sheet-fondo" onClick={() => setAbierto(false)}>
          <div
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Cambiar de contexto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="titulo-seccion" style={{ marginBottom: 10 }}>¿Qué estás gestionando?</p>
            {comercios.map((c) => {
              const esComercioActivo = c.comercioId === comercioActivoId;
              return (
                <div key={c.comercioId} style={{ marginBottom: 12 }}>
                  <button
                    type="button"
                    className={`sheet-fila${esComercioActivo && !sucursalActiva ? ' sheet-fila-activa' : ''}`}
                    disabled={pendiente}
                    onClick={() => elegir(c.comercioId, null)}
                  >
                    <span className="icono" aria-hidden="true">storefront</span>
                    <span>
                      <span style={{ display: 'block', fontWeight: 700 }}>{c.nombre}</span>
                      <span className="admin-fila-slug">Todas las sucursales</span>
                    </span>
                  </button>
                  {c.sucursales.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`sheet-fila sheet-fila-sub${esComercioActivo && sucursalActiva?.id === s.id ? ' sheet-fila-activa' : ''}`}
                      disabled={pendiente}
                      onClick={() => elegir(c.comercioId, s.id)}
                    >
                      <span className="icono" aria-hidden="true">{s.esPrincipal ? 'home_pin' : 'store'}</span>
                      <span>
                        {s.nombre}
                        {s.esPrincipal && (
                          <span className="admin-fila-slug" style={{ marginLeft: 8 }}>Principal</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
            <Link
              className="sheet-agregar"
              href="/comercio/sucursales?agregar=1"
              onClick={() => setAbierto(false)}
            >
              <span className="icono" aria-hidden="true">add_circle</span>
              Agregar local…
            </Link>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
