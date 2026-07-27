'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import ListaTemas from './ListaTemas';

// "¿Ya estamos en el navegador?" sin setState en un effect (esa regla es ERROR en este repo).
// Hace falta porque la hoja se monta con createPortal sobre document.body, que no existe en el
// servidor: en SSR devuelve false y el portal simplemente no se renderiza.
const suscribirNada = () => () => {};
const useEstaEnCliente = () => useSyncExternalStore(suscribirNada, () => true, () => false);

// Selector de tema autónomo (botón + hoja inferior) para pantallas que NO tienen un menú donde
// meter la lista. Lo usa el header de /admin.
//
// POR QUÉ EXISTE: el tema se guarda en el <html>, así que es global — si el dueño elige claro desde
// el panel de comercio en su teléfono, /admin también queda claro. Sin un selector acá, la única
// salida sería irse a OTRA sección del producto a cambiar una preferencia para arreglar la pantalla
// en la que estaba. Eso es un callejón sin salida, no una preferencia.
export default function SelectorTema() {
  const [abierto, setAbierto] = useState(false);
  const enCliente = useEstaEnCliente();

  // Escape cierra la hoja. El listener va en `document` y NO un onKeyDown en el panel: al abrir, el
  // foco se queda en el botón (FUERA del panel), así que un handler local nunca recibiría la tecla.
  // Sin esto un usuario de solo-teclado no tiene salida: el fondo es un div, no activable con
  // teclado. (Mismo pendiente que SelectorContexto y MenuOpciones: migrar las tres hojas al
  // <dialog> nativo, que trae Escape, trampa de foco e inert bien implementados por el navegador.)
  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [abierto]);

  return (
    <>
      {/* Ícono FIJO ("contrast") y no el del tema activo: el del tema activo tendría que esperar a
          la hidratación para saber cuál es, y se vería cambiar solo después de cargar — un parpadeo
          en la misma pantalla que existe para eliminar parpadeos. */}
      <button
        type="button"
        className="menu-boton"
        onClick={() => setAbierto(true)}
        aria-expanded={abierto}
        aria-label="Apariencia: cambiar el tema"
      >
        <span className="icono" aria-hidden="true">contrast</span>
      </button>

      {/* PORTAL A document.body, NO lo saques: la hoja es position:fixed y se ancla al viewport SOLO
          si ningún ancestro crea un containing block. Este botón vive dentro de .admin-top — la
          MISMA clase que usa el header de /comercio, con su `backdrop-filter` para el efecto vidrio
          — y backdrop-filter (igual que transform o filter) convierte al elemento en el marco de
          referencia de sus descendientes fixed. Sin el portal la hoja se dibuja pegada al header,
          cortada y sin scroll: el bug que ya se reportó en producción con el switcher de contexto
          (2026-07-26) y antes con el modal de Sucursales. */}
      {abierto && enCliente && createPortal(
        <div className="sheet-fondo" onClick={() => setAbierto(false)}>
          <div
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Apariencia"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="titulo-seccion" style={{ marginBottom: 10 }}>Apariencia</p>
            <ListaTemas />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
