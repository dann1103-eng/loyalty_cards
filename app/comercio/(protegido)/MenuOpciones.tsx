'use client';

import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { enlacesMenuPorRol, type EnlaceNav } from '@/lib/comercio/navegacion';
import ListaTemas from '@/app/_ui/ListaTemas';
import { cerrarSesionComercio } from '../actions';

// "¿Ya estamos en el navegador?" sin setState en un effect (esa regla es ERROR en este repo).
// Hace falta porque el sheet se monta con createPortal sobre document.body, que no existe en el
// servidor: en SSR devuelve false y el portal simplemente no se renderiza. Mismo truco que
// SelectorContexto — si algún día se extrae a un hook compartido, que sea con los dos a la vez.
const suscribirNada = () => () => {};
const useEstaEnCliente = () => useSyncExternalStore(suscribirNada, () => true, () => false);

// Orden fijo y rótulos de las tres secciones del menú agrupado (spec 2026-09-21, "Menú 'más
// opciones', agrupado", línea 320): Tu programa (Reglas/Programas/Notificaciones) → Tu equipo y
// locales (Sucursales/Cajeros) → Cuenta (Mi plan). El orden vive ACÁ, no en navegacion.ts: ese
// módulo es la política de qué ve cada rol, no cómo se presenta visualmente.
//
// ORDEN_GRUPOS se DERIVA de las claves de ROTULO_GRUPO (no es una lista aparte): un cuarto valor
// que se sume al union `grupo` de EnlaceNav obliga a TypeScript a agregarlo acá (Record exhaustivo)
// y, con eso, entra solo al orden de recorrido — un grupo nuevo con rótulo pero sin orden ya no se
// puede olvidar por separado, que era exactamente el hueco (silencioso: el enlace desaparecía del
// menú sin ningún error de tipos ni de prueba) que tenía la versión con dos listas.
const ROTULO_GRUPO: Record<NonNullable<EnlaceNav['grupo']>, string> = {
  programa: 'Tu programa',
  equipo: 'Tu equipo y locales',
  cuenta: 'Cuenta',
};
const ORDEN_GRUPOS = Object.keys(ROTULO_GRUPO) as Array<keyof typeof ROTULO_GRUPO>;

// Menú de "más opciones" del header: las secciones que no entran en la barra inferior de 5 destinos
// + el selector de tema + cerrar sesión.
//
// POR QUÉ "Salir" se mudó acá desde el header: el header a 360px ya estaba al límite (la cuenta
// completa está en el comentario de .contexto-pastilla en globals.css — la pastilla de contexto
// resuelve en ~104px y ahí se corta el nombre de la sucursal). Meter un botón de 44px MÁS le
// robaba ~56px a la marca y a la pastilla. Cerrar sesión se hace una vez al día; escanear, decenas
// de veces: el ancho es de quien lo usa más. El <form> es el MISMO y la Server Action también —
// cambia dónde está el botón, no el mecanismo.
// `tipoTarjeta` (el del programa principal) NO es decorativo acá: es el MISMO argumento que recibe
// la barra, y las dos superficies tienen que decidir con él a la vez. Premios y Programas se
// intercambian, así que si el tipo llegara solo a la barra, Programas subiría ahí y SEGUIRÍA en
// este menú: el mismo destino dos veces (ver lib/comercio/navegacion.ts).
export default function MenuOpciones({ rol, tipoTarjeta }: { rol: string; tipoTarjeta: string }) {
  const [abierto, setAbierto] = useState(false);
  const enCliente = useEstaEnCliente();
  const ruta = usePathname();
  const enlaces = enlacesMenuPorRol(rol, tipoTarjeta);

  // Escape cierra el menú. El listener va en `document` y NO un onKeyDown en el panel: al abrir, el
  // foco se queda en el botón de hamburguesa (FUERA del panel), así que un handler local nunca
  // recibiría la tecla. Sin esto, un usuario de solo-teclado no tiene salida: el fondo es un div,
  // no activable con teclado. (Mismo pendiente que SelectorContexto y SelectorTema: migrar las tres
  // hojas al <dialog> nativo, que trae Escape, trampa de foco e inert gratis.)
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

      {/* PORTAL A document.body, NO lo saques. La razón es VIVA, no hipotética: .admin-top es
          `position: sticky` con `z-index: 40`, y eso crea un contexto de apilamiento. Un sheet que se
          pinte adentro queda atrapado en él, y la barra inferior (`z-index: 50`, hermana del header)
          le pasa por ENCIMA: "Cerrar sesión" queda tapada (medido con elementsFromPoint a 360×740).
          Además, si alguna vez vuelve un backdrop-filter, un transform o un filter al header, el
          position: fixed de acá adentro dejaría de ser relativo a la ventana y el sheet se dibujaría
          pegado al header: el bug reportado en producción con el switcher de contexto (2026-07-26),
          y antes con el modal de Sucursales. */}
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

            {ORDEN_GRUPOS.map((grupo) => {
              const enlacesDelGrupo = resto.filter((e) => e.grupo === grupo);
              // Un grupo sin enlaces no imprime su encabezado: no debería pasar con el reparto de
              // hoy (los tres grupos siempre tienen al menos un enlace), pero nada en el tipo lo
              // garantiza — ver navegacion.test.ts.
              if (enlacesDelGrupo.length === 0) return null;
              return (
                <Fragment key={grupo}>
                  <p className="titulo-seccion menu-rotulo">{ROTULO_GRUPO[grupo]}</p>
                  {enlacesDelGrupo.map((e) => (
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
                </Fragment>
              );
            })}

            {/* El selector de tema lo ve TODO rol, incluido el cajero (que no ve ninguna sección
                acá): alto contraste existe justamente para el que atiende con el sol de frente. */}
            <p className="titulo-seccion menu-rotulo">Apariencia</p>
            <ListaTemas />

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
