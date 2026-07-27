'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { enlacesMenuPorRol } from '@/lib/comercio/navegacion';
import {
  ETIQUETAS_TEMA,
  TEMAS,
  aplicarTema,
  leerTema,
  leerTemaServidor,
  suscribirTema,
} from '@/lib/tema';
import { cerrarSesionComercio } from '../actions';

// "¿Ya estamos en el navegador?" sin setState en un effect (esa regla es ERROR en este repo).
// Hace falta porque el sheet se monta con createPortal sobre document.body, que no existe en el
// servidor: en SSR devuelve false y el portal simplemente no se renderiza. Mismo truco que
// SelectorContexto — si algún día se extrae a un hook compartido, que sea con los dos a la vez.
const suscribirNada = () => () => {};
const useEstaEnCliente = () => useSyncExternalStore(suscribirNada, () => true, () => false);

// Menú de "más opciones" del header: las secciones que no entran en la barra inferior de 5 destinos
// + el selector de tema + cerrar sesión.
//
// POR QUÉ "Salir" se mudó acá desde el header: el header a 360px ya estaba al límite (la cuenta
// completa está en el comentario de .contexto-pastilla en globals.css — la pastilla de contexto
// resuelve en ~104px y ahí se corta el nombre de la sucursal). Meter un botón de 44px MÁS le
// robaba ~56px a la marca y a la pastilla. Cerrar sesión se hace una vez al día; escanear, decenas
// de veces: el ancho es de quien lo usa más. El <form> es el MISMO y la Server Action también —
// cambia dónde está el botón, no el mecanismo.
export default function MenuOpciones({ rol }: { rol: string }) {
  const [abierto, setAbierto] = useState(false);
  const enCliente = useEstaEnCliente();
  const ruta = usePathname();
  const enlaces = enlacesMenuPorRol(rol);
  // El tema real es el atributo data-tema del <html> (lo fijó el script del <head> antes del primer
  // pintado). useSyncExternalStore lo lee sin setState-en-effect y sin desajuste de hidratación: en
  // el servidor devuelve el tema por defecto, que es con el que se sirvió el HTML.
  const tema = useSyncExternalStore(suscribirTema, leerTema, leerTemaServidor);

  // Escape cierra el menú. El listener va en `document` y NO un onKeyDown en el panel: al abrir, el
  // foco se queda en el botón de hamburguesa (FUERA del panel), así que un handler local nunca
  // recibiría la tecla. Sin esto, un usuario de solo-teclado no tiene salida: el fondo es un div,
  // no activable con teclado. (Mismo pendiente que SelectorContexto: migrar los dos sheets al
  // <dialog> nativo, que trae Escape, trampa de foco e inert gratis.)
  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [abierto]);

  const esActiva = (href: string) => ruta === href || ruta.startsWith(`${href}/`);

  // El primer enlace del menú es Reportes (lo garantiza lib/comercio/navegacion.ts y su test) y va
  // en su propio bloque, arriba y con más peso visual: es la sección más consultada de las que ya
  // no están en la barra, y al final de una lista se volvía invisible.
  const [destacado, ...resto] = enlaces;

  return (
    <>
      <button
        type="button"
        className="menu-boton"
        onClick={() => setAbierto(true)}
        aria-expanded={abierto}
        aria-label="Más opciones"
      >
        <span className="icono" aria-hidden="true">menu</span>
      </button>

      {/* PORTAL A document.body, NO lo saques: el sheet es position:fixed y se ancla al viewport
          SOLO si ningún ancestro crea un containing block. Este botón vive dentro de .admin-top,
          que tiene `backdrop-filter` para el efecto vidrio — y backdrop-filter (igual que transform
          o filter) convierte al elemento en el marco de referencia de sus descendientes fixed. Sin
          el portal el panel se dibuja pegado al header en vez de subir desde abajo, cortado y sin
          scroll: exactamente el bug que se reportó en producción con el switcher de contexto
          (2026-07-26) y antes con el modal de Sucursales. */}
      {abierto && enCliente && createPortal(
        <div className="sheet-fondo" onClick={() => setAbierto(false)}>
          <div
            className="sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Más opciones"
            onClick={(e) => e.stopPropagation()}
          >
            {destacado && (
              <Link
                href={destacado.href}
                className={`menu-destacado${esActiva(destacado.href) ? ' menu-destacado-activo' : ''}`}
                aria-current={esActiva(destacado.href) ? 'page' : undefined}
                onClick={() => setAbierto(false)}
              >
                <span className="icono-circulo acento" aria-hidden="true">
                  <span className="icono icono-lleno">{destacado.icono}</span>
                </span>
                <span>
                  <span className="admin-fila-nombre" style={{ display: 'block' }}>
                    {destacado.etiqueta}
                  </span>
                  <span className="admin-fila-slug">Ventas, canjes y clientes nuevos</span>
                </span>
                <span className="icono icono-chevron" aria-hidden="true">chevron_right</span>
              </Link>
            )}

            {resto.length > 0 && (
              <>
                <p className="titulo-seccion menu-rotulo">Configuración</p>
                {resto.map((e) => (
                  <Link
                    key={e.href}
                    href={e.href}
                    className={`sheet-fila${esActiva(e.href) ? ' sheet-fila-activa' : ''}`}
                    aria-current={esActiva(e.href) ? 'page' : undefined}
                    onClick={() => setAbierto(false)}
                  >
                    <span className="icono" aria-hidden="true">{e.icono}</span>
                    <span>{e.etiqueta}</span>
                  </Link>
                ))}
              </>
            )}

            {/* El selector de tema lo ve TODO rol, incluido el cajero (que no ve ninguna sección
                acá): alto contraste existe justamente para el que atiende con el sol de frente. */}
            <p className="titulo-seccion menu-rotulo">Apariencia</p>
            <div className="menu-temas">
              {TEMAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`sheet-fila menu-tema${t === tema ? ' sheet-fila-activa' : ''}`}
                  aria-pressed={t === tema}
                  // A propósito NO cierra el menú: el sheet se repinta con el tema recién elegido y
                  // el dueño puede probar los tres seguidos sin volver a abrirlo tres veces.
                  onClick={() => aplicarTema(t)}
                >
                  <span className="icono" aria-hidden="true">{ETIQUETAS_TEMA[t].icono}</span>
                  <span>
                    <span style={{ display: 'block', fontWeight: 600 }}>
                      {ETIQUETAS_TEMA[t].nombre}
                    </span>
                    <span className="admin-fila-slug">{ETIQUETAS_TEMA[t].ayuda}</span>
                  </span>
                  {t === tema && (
                    <span className="icono icono-lleno menu-tick" aria-hidden="true">check</span>
                  )}
                </button>
              ))}
            </div>

            <form action={cerrarSesionComercio} className="menu-salir">
              <button className="sheet-fila" type="submit">
                <span className="icono" aria-hidden="true">logout</span>
                <span>Cerrar sesión</span>
              </button>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
