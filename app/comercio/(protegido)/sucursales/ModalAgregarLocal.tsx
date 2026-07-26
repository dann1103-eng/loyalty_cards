'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { accionCrearSucursal, accionCrearComercioPropio } from './actions';
import { TIPOS_TARJETA } from '@/lib/comercios/guardarComercio';

type Paso = 'elegir' | 'sucursal' | 'comercio';

// Modal "¿Qué estás creando?" (plan 2026-07-25 §4.6). La página solo lo renderiza cuando HAY cupo.
// El alta de comercio redirige a /marca desde el server (su caso de éxito nunca vuelve acá); el de
// sucursal devuelve {ok} y el modal se cierra (la lista de atrás ya se revalidó).
export default function ModalAgregarLocal({
  nombreComercio,
  puedeCrearComercio,
  abrirAlCargar,
}: {
  nombreComercio: string;
  puedeCrearComercio: boolean;
  abrirAlCargar: boolean;
}) {
  const [abierto, setAbierto] = useState(abrirAlCargar);
  const [paso, setPaso] = useState<Paso>('elegir');

  const router = useRouter();

  // Las dos altas comparten el patrón del sheet de SelectorContexto: transición + llamada DIRECTA a
  // la acción, resolviendo cierre y error en el callback, donde ya se tiene el resultado en la mano.
  // NO useActionState + useEffect: llamar a setState en el cuerpo de un efecto es error de lint
  // (react-hooks/set-state-in-effect) y agrega un render de sincronización que acá no hace falta.
  // Por eso accionCrearSucursal devuelve {ok:true} en vez de undefined: es lo que distingue el
  // éxito. El primer argumento de cada acción es el `estadoPrevio` del contrato de useActionState,
  // que ambas ignoran.
  const [errorSucursal, setErrorSucursal] = useState<string | null>(null);
  const [pendienteSucursal, iniciarSucursal] = useTransition();
  const [errorComercio, setErrorComercio] = useState<string | null>(null);
  const [pendienteComercio, iniciarComercio] = useTransition();

  // Cerrojo contra el doble submit. `disabled={pendiente}` NO alcanza: el flag recién llega con el
  // re-render, así que un doble toque dentro del MISMO frame despacha dos veces — y una transición
  // (igual que useActionState) ENCOLA el segundo envío en vez de descartarlo. El ref se marca
  // sincrónicamente, antes de despachar, así que el segundo submit muere acá.
  // Pesa sobre todo en el alta de comercio: dos comercios duplicados consumen dos unidades del
  // plan, arrastran su sucursal Principal y su membresía, y el dueño NO puede borrarlos — los
  // limpia FM a mano. Se libera al FALLAR (para poder reintentar); en el éxito no hace falta,
  // porque el alta de comercio redirige y la de sucursal cierra el modal.
  const enviandoSucursal = useRef(false);
  const enviandoComercio = useRef(false);

  // useCallback y no una función suelta: el efecto de Escape la lleva en sus deps, y con una
  // identidad nueva por render se re-suscribiría el listener en cada uno.
  const cerrar = useCallback(() => {
    setAbierto(false);
    setPaso('elegir');
    setErrorSucursal(null);
    setErrorComercio(null);
    // `?agregar=1` (el enlace "Agregar local…" del switcher) ya cumplió su función al abrir el
    // modal. Si se queda en la URL, recargar o volver acá lo reabre solo: un fantasma difícil de
    // explicar. replace y no push para NO agregar una entrada al historial, y scroll:false porque
    // el contenido de la página no cambió. Va condicionado a abrirAlCargar: sin el parámetro esto
    // sería una navegación inútil a la misma URL.
    if (abrirAlCargar) router.replace('/comercio/sucursales', { scroll: false });
  }, [abrirAlCargar, router]);

  const crearSucursal = (formData: FormData) => {
    if (enviandoSucursal.current) return;
    enviandoSucursal.current = true;
    iniciarSucursal(async () => {
      const res = await accionCrearSucursal(undefined, formData);
      enviandoSucursal.current = false;
      if (res && 'error' in res) {
        setErrorSucursal(res.error);
        return;
      }
      cerrar(); // la lista de atrás ya se revalidó en el server
    });
  };

  const crearComercio = (formData: FormData) => {
    if (enviandoComercio.current) return;
    enviandoComercio.current = true;
    iniciarComercio(async () => {
      const res = await accionCrearComercioPropio(undefined, formData);
      // Solo se llega acá si el alta FALLÓ: el éxito redirige desde el server y esta línea no
      // corre (mismo comportamiento que SelectorContexto documenta para cambiarContextoActivo).
      enviandoComercio.current = false;
      setErrorComercio(res?.error ?? null);
    });
  };

  // Escape cierra el sheet. El listener va en `document`, NO un onKeyDown en el panel: al abrir, el
  // foco se queda en el botón "Agregar local" (FUERA del panel) — y con `abrirAlCargar` ni siquiera
  // hubo un click —, así que un handler local nunca recibiría la tecla: sería decoración. Mismo
  // patrón (y misma razón) que SelectorContexto; no lo "simplifiques" moviéndolo al div del panel.
  // Sin esto, un usuario de solo-teclado no tiene salida: no hay botón de cerrar y el fondo es un
  // div (no activable con teclado).
  useEffect(() => {
    if (!abierto) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    document.addEventListener('keydown', alTeclado);
    return () => document.removeEventListener('keydown', alTeclado);
  }, [abierto, cerrar]);

  const boton = (
    <button className="btn-primary" type="button" disabled={abierto} onClick={() => setAbierto(true)}>
      <span className="icono" style={{ fontSize: 18 }} aria-hidden="true">add_circle</span>
      Agregar local
    </button>
  );

  if (!abierto) return boton;

  const tiposDisponibles = TIPOS_TARJETA.filter((t) => t.disponible);

  return (
    <>
      {boton}
      <div className="sheet-fondo" onClick={cerrar}>
        <div
          className="sheet-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Agregar local"
          onClick={(e) => e.stopPropagation()}
        >
          {paso === 'elegir' && (
            <>
              <p className="titulo-seccion" style={{ marginBottom: 10 }}>¿Qué estás creando?</p>
              <button type="button" className="sheet-fila" onClick={() => setPaso('sucursal')}>
                <span className="icono" aria-hidden="true">store</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700 }}>Sucursal</span>
                  <span className="admin-fila-slug">
                    Otro local que usa la misma tarjeta de {nombreComercio}.
                  </span>
                </span>
              </button>
              {/* Sin cuenta no hay dónde crear el comercio: deshabilitado y con el motivo abajo.
                  El look de "muerto" lo pone .sheet-fila:disabled en globals.css (compartido con el
                  switcher), NO un style inline. */}
              <button
                type="button"
                className="sheet-fila"
                disabled={!puedeCrearComercio}
                onClick={() => setPaso('comercio')}
              >
                <span className="icono" aria-hidden="true">storefront</span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700 }}>Comercio nuevo</span>
                  <span className="admin-fila-slug">
                    {puedeCrearComercio
                      ? 'Otra marca, con su propia tarjeta e identidad.'
                      : 'Tu comercio no está asociado a una cuenta — contactá a FM.'}
                  </span>
                </span>
              </button>
            </>
          )}

          {paso === 'sucursal' && (
            <form action={crearSucursal}>
              <p className="titulo-seccion" style={{ marginBottom: 10 }}>Nueva sucursal</p>
              <p className="admin-fila-slug" style={{ marginBottom: 12 }}>
                Va a usar la misma tarjeta y el mismo QR de registro de {nombreComercio}.
              </p>
              <div className="field">
                <label htmlFor="nombre-sucursal">Nombre de la sucursal</label>
                <input id="nombre-sucursal" name="nombre" placeholder="Sucursal Centro" required />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-borde" type="button" onClick={() => setPaso('elegir')}>
                  Volver
                </button>
                <button className="btn-primary" type="submit" disabled={pendienteSucursal}>
                  {pendienteSucursal ? 'Agregando…' : 'Agregar sucursal'}
                </button>
              </div>
              {errorSucursal && <p className="alerta" role="alert">{errorSucursal}</p>}
            </form>
          )}

          {paso === 'comercio' && (
            <form action={crearComercio}>
              <p className="titulo-seccion" style={{ marginBottom: 10 }}>Comercio nuevo</p>
              <p className="admin-fila-slug" style={{ marginBottom: 12 }}>
                Al crearlo te llevamos al editor de marca para configurar su identidad.
              </p>
              <div className="field">
                <label htmlFor="nombre-comercio">Nombre del comercio</label>
                <input id="nombre-comercio" name="nombre" placeholder="Verde Raíz Café" required />
              </div>
              <div className="field">
                <label>Tipo de tarjeta</label>
                {tiposDisponibles.map((t, i) => (
                  <label
                    key={t.valor}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: 'pointer' }}
                  >
                    <input type="radio" name="tipoTarjeta" value={t.valor} defaultChecked={i === 0} required />
                    <span>
                      <span style={{ display: 'block', fontWeight: 600 }}>{t.etiqueta}</span>
                      <span className="admin-fila-slug">{t.descripcion}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-borde" type="button" onClick={() => setPaso('elegir')}>
                  Volver
                </button>
                <button className="btn-primary" type="submit" disabled={pendienteComercio}>
                  {pendienteComercio ? 'Creando…' : 'Crear comercio'}
                </button>
              </div>
              {errorComercio && <p className="alerta" role="alert">{errorComercio}</p>}
            </form>
          )}
        </div>
      </div>
    </>
  );
}
