'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { PAISES, PAIS_DEFAULT, buscarPaisPorClave } from '@/lib/clientes/paises';
import { billeteraDeEntrada, fraseWalletDelFormulario, type Plataforma } from '@/lib/clientes/plataforma';
import { frentePase } from '@/lib/tarjetas/frentePase';
import { promesaRegistro, promesaTarjetaLista, rotuloTarjeta } from '@/lib/tarjetas/textosPorTipo';
import BotonesWallet from '@/app/_ui/BotonesWallet';
import type { MarcaRegistro } from './marcaDelRegistro';

// La tarjeta de muestra que ve el cliente junto al botón de Wallet. Es una RÉPLICA de su pase, no
// un adorno: hasta el 2026-09-08 tenía un degradado marrón cableado, el rótulo "Tarjeta de lealtad"
// y "0 PUNTOS" para los ocho tipos, así que el dueño de una membresía azul con logo veía —al
// escanear su propio QR— una tarjeta café que le prometía a su cliente una mecánica inexistente.
//
// El estado sale de `frentePase`, la MISMA función que arma el frente del pase real y la vista
// previa del editor de marca. Es a propósito y es un guardarraíl: si esta pantalla volviera a
// tener su propio if, el dueño diseñaría una cosa y su cliente vería otra.
function VistaTarjeta({
  nombreComercio,
  tipoTarjeta,
  selloMeta,
  marca,
  hoyIso,
}: {
  nombreComercio: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  marca: MarcaRegistro;
  hoyIso: string;
}) {
  // De `frentePase` esta réplica usa SOLO `estado` (lo que el pase lleva arriba a la derecha): el
  // contador del tipo ("SELLOS 0 de 10", "SALDO $0.00") o, en membresía y cupón, su estado sin fecha.
  //
  // - `franja: 'banda'` es literal, no una simplificación: esta tarjeta de muestra no dibuja franja
  //   ni grilla. Solo decide `sobreFranja`, que acá no se muestra — y el estado no depende de ella.
  // - `puntos: 0` porque la tarjeta acaba de nacer.
  // - `vigenciaHasta`/`usadoEn` en null: acá NO hay ninguna tarjeta emitida todavía, y ahí el estado
  //   dice "MEMBRESÍA · Sin activar" o "CUPÓN · Disponible" sin mirar el reloj — que es exactamente
  //   el estado que va a tener la tarjeta el primer día.
  // - `nombrePase` no viaja: esta pantalla ya rotula la tarjeta con `rotuloTarjeta` arriba.
  // - `nombreCliente`/`apellidoCliente` en null: esta réplica no dibuja el titular, así que no se le
  //   pasa lo que el cliente acaba de escribir.
  //
  // `hoyIso` igual llega desde el SERVIDOR y no de un new Date() acá: este componente es
  // 'use client' montado desde una página de servidor, y un reloj propio daría mismatch de
  // hidratación. La regla vale aunque hoy el valor no se llegue a leer.
  const frente = frentePase({
    tipoTarjeta, puntos: 0, selloMeta, franja: 'banda',
    vigenciaHasta: null, usadoEn: null, nombrePase: null,
    nombreCliente: null, apellidoCliente: null, hoyIso,
  });

  // Mismos respaldos que la cara de la tarjeta del portal (mi-tarjeta/PortalCliente.tsx): un
  // comercio sin colores cargados cae al fondo oscuro del sistema, no a un café inventado.
  const fondo = marca.colorFondo ?? '#131315';
  const texto = marca.colorTexto ?? '#f5f5f0';
  const label = marca.colorLabel ?? undefined;
  const estiloLabel = label ? { color: label } : undefined;

  return (
    <div className="cardface" style={{ background: fondo, color: texto }}>
      <div className="cardface-top" style={estiloLabel}>
        {/* La etiqueta del catálogo: "Membresía", "Cupón", "Gift card"… La palabra que el dueño
            eligió al crear su programa, no "Tarjeta de lealtad" para todos. */}
        <span>{rotuloTarjeta(tipoTarjeta)}</span>
        <span>Cardly SV</span>
      </div>
      {marca.logoUrl && (
        <div className="cardface-logo">
          {/* <img> y no next/image: la URL viene del bucket público de Supabase y next/image
              exigiría declarar el dominio, sin ganancia en un logo de 54 px. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- URL pública del bucket */}
          <img src={marca.logoUrl} alt={`Logo de ${nombreComercio}`} />
        </div>
      )}
      <div className="cardface-name">{nombreComercio}</div>
      {/* SIN ESTADO NO SE DIBUJA EL BLOQUE. El descuento no lleva estado —su porcentaje sale de
          los niveles, un dato que el pase no recibe— y su pase real tampoco lo lleva. */}
      {frente.estado && (
        // Etiqueta arriba y valor abajo, como los dibuja Apple y como los replica el editor de
        // marca. El valor compuesto ("0 de 10", "$0.00", "Sin activar") no entra a 2.2rem en un
        // teléfono angosto, así que el número pelado se queda grande y el texto baja de tamaño.
        <div className="cardface-points" style={{ flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={estiloLabel}>{frente.estado.etiqueta}</span>
          <b style={frente.estado.numero === null ? { fontSize: '1.5rem' } : undefined}>
            {frente.estado.valor}
          </b>
        </div>
      )}
    </div>
  );
}

// Clave de sessionStorage del paso de reseña, por slug de comercio (spec sección 3, Tarea 8).
// sessionStorage ya es por pestaña, pero una misma pestaña puede pasar por el registro de dos
// comercios (escaneó el QR de uno y después el de otro): el toque del link de A no tiene que
// habilitar el botón de B.
function claveResenaTocada(comercioSlug: string): string {
  return `cardly:resena-tocada:${comercioSlug}`;
}

// useSyncExternalStore no necesita suscribirse a nada: sessionStorage solo cambia por nuestro propio
// clic (cubierto por tocoGoogleEnMemoria, un useState normal), nunca por otra pestaña ni por un
// evento del navegador. NO "arreglar" esto agregando una suscripción: el valor guardado igual llega,
// porque después de hidratar React vuelve a llamar a getSnapshot en un efecto pasivo y, si difiere
// del snapshot del servidor, re-renderiza — ahí se habilita el botón tras una recarga.
const suscribirNada = () => () => {};

// Lo que sessionStorage recuerda de una visita anterior a ESTA pestaña: true si iOS la recargó
// después de que el cliente ya tocó el link de Google (Safari puede descartarla por memoria al
// volver de la app de Maps y reconstruirla desde cero). Se lee con useSyncExternalStore y NO con
// useState + useEffect: el snapshot del SERVIDOR es siempre `false` (sessionStorage no existe ahí),
// y React usa ESE MISMO valor para el primer render del cliente — la garantía de hidratación que
// pide la spec, sin el patrón "leer en un efecto y guardar con setState" (esa regla de lint es
// ERROR en este repo; mismo criterio que useEstaEnCliente en app/_ui/SelectorTema.tsx).
function useTocoGoogleAlmacenado(comercioSlug: string, activo: boolean): boolean {
  return useSyncExternalStore(
    suscribirNada,
    () => {
      if (!activo) return false; // sin paso de reseña, ni vale la pena tocar sessionStorage
      try {
        return sessionStorage.getItem(claveResenaTocada(comercioSlug)) === '1';
      } catch {
        return false; // modo privado de Safari u otro storage bloqueado
      }
    },
    () => false,
  );
}

export default function RegistroCliente({
  comercioSlug,
  programaSlug,
  nombreComercio,
  tipoTarjeta,
  selloMeta,
  marca,
  resenaGoogleUrl,
  hoyIso,
  plataforma,
}: {
  comercioSlug: string;
  // null = el programa principal (migración 0024) — ver app/registro/[comercioSlug]/page.tsx.
  programaSlug: string | null;
  nombreComercio: string;
  // El tipo del PROGRAMA que se está registrando (no `comercios.tipo_tarjeta`, columna legada desde
  // la 0024). Las dos páginas ya lo tenían resuelto y no lo pasaban: de ahí salían el rótulo, el
  // contador y la promesa equivocados.
  tipoTarjeta: string;
  selloMeta: number | null;
  marca: MarcaRegistro;
  // El link de reseña de Google, YA REVALIDADO por `leerResenaGoogle` — o `null` si el comercio no
  // pide reseña (`pedir_resena_google` apagado) o si la lectura falló (columna de la 0039 todavía
  // no aplicada, error de red…). Con `null` esta pantalla no cambia en nada: el paso de reseña
  // directamente no se dibuja (spec sección 3, "Lo que ve el cliente").
  resenaGoogleUrl: string | null;
  // El "hoy" del comercio, resuelto en el servidor (hoyEnZona). Baja hasta la tarjeta de muestra.
  hoyIso: string;
  // Detectada en el SERVIDOR (detectarPlataforma sobre el user agent), en la page.tsx que llama:
  // decide qué botón de Wallet ve primero el cliente (spec Wallet/logos §1) y qué dice la promesa
  // del formulario ("Directo en tu ___").
  plataforma: Plataforma;
}) {
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [telefono, setTelefono] = useState('');
  // País del teléfono. El Salvador por defecto: es el mercado actual y el país de todos los
  // clientes ya registrados.
  const [clavePais, setClavePais] = useState(PAIS_DEFAULT);
  const [tarjetaId, setTarjetaId] = useState<string | null>(null);
  const [googleWalletDisponible, setGoogleWalletDisponible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Paso de reseña de Google, dos estados con nombre propio (spec sección 3):
  // - tocoGoogle: el cliente tocó "Dejar mi reseña en Google". Habilita "Ya la dejé". Es la unión de
  //   DOS fuentes: tocoGoogleEnMemoria (el clic de ESTA carga de la página, un useState normal, para
  //   que el botón responda al toque sin esperar ninguna vuelta al servidor ni a sessionStorage) y
  //   tocoGoogleAlmacenado (lo que sessionStorage recuerda de ANTES de esta carga — ver el comentario
  //   de useTocoGoogleAlmacenado más arriba).
  // - continuo: el cliente ya pasó al formulario de siempre. NO se guarda: el paso de reseña es algo
  //   que el COMERCIO pide en cada registro, no una preferencia del cliente que deba sobrevivir una
  //   visita nueva.
  const [tocoGoogleEnMemoria, setTocoGoogleEnMemoria] = useState(false);
  const tocoGoogleAlmacenado = useTocoGoogleAlmacenado(comercioSlug, resenaGoogleUrl !== null);
  const tocoGoogle = tocoGoogleEnMemoria || tocoGoogleAlmacenado;
  const [continuo, setContinuo] = useState(false);

  function tocarLinkGoogle() {
    setTocoGoogleEnMemoria(true);
    try {
      sessionStorage.setItem(claveResenaTocada(comercioSlug), '1');
    } catch {
      // Modo privado de Safari u otro storage bloqueado: el toque no sobrevive una recarga de la
      // pestaña, pero tocoGoogleEnMemoria ya alcanza para habilitar "Ya la dejé" en esta carga.
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/registro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comercioSlug, programaSlug, nombre, apellido, telefono, clavePais }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al registrar');
      setTarjetaId(data.tarjetaId);
      setGoogleWalletDisponible(Boolean(data.googleWalletDisponible));
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
          {/* La tarjeta YA existe: acá no se vuelve a prometer el beneficio, se dice qué acaba de
              quedar en el teléfono. No interpola el nombre del comercio a propósito —— ya está en la
              tarjeta de muestra de abajo, y un nombre largo rompía la frase.
              Nombra la billetera del botón que <BotonesWallet> dibuja DE ENTRADA (Tarea 6b): el
              `googleDisponible` es el mismo booleano que decide su `urlGoogle`, y no depende del
              link "¿Tienes otro teléfono?" —— ese estado vive dentro de BotonesWallet y el subtítulo
              no cambia al tocarlo. */}
          <p className="lede reveal d2">
            {promesaTarjetaLista(
              tipoTarjeta,
              billeteraDeEntrada({ plataforma, googleDisponible: googleWalletDisponible }),
            )}
          </p>
          <div className="panel reveal d3" style={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, marginTop: 26 }}>
            <VistaTarjeta
              nombreComercio={nombreComercio}
              tipoTarjeta={tipoTarjeta}
              selloMeta={selloMeta}
              marca={marca}
              hoyIso={hoyIso}
            />
            <BotonesWallet
              plataforma={plataforma}
              urlApple={`/api/tarjetas/${tarjetaId}/pass.pkpass`}
              urlGoogle={googleWalletDisponible ? `/api/tarjetas/${tarjetaId}/google-wallet` : null}
              textoApple="Agregar a Apple Wallet"
              textoGoogle="Agregar a Google Wallet"
            />
          </div>
        </div>
      </main>
    );
  }

  // Paso de reseña de Google, antes del formulario de siempre. Se dibuja mientras haya link (el
  // comercio lo pide) y el cliente todavía no haya tocado "Ya la dejé, sacar mi tarjeta" — la misma
  // condición que documenta el plan (Tarea 8): no crece más allá de esto, así que se queda inline en
  // vez de salir a una función pura aparte.
  if (resenaGoogleUrl !== null && !continuo) {
    return (
      <main className="shell">
        <div className="stack">
          <p className="kicker reveal d1">{nombreComercio}</p>
          <h1 className="title reveal d2">
            Antes de <em>tu tarjeta</em>
          </h1>
          {/* Texto fijo, sin personalización por comercio (decisión 5 de la spec): la promesa del
              primer sello la hace el comercio de palabra (cartel, cajero), no esta pantalla. */}
          <p className="lede reveal d2">¿Nos dejas una reseña en Google? Nos ayuda muchísimo.</p>
          <div className="panel reveal d3">
            <a
              className="btn-primary"
              href={resenaGoogleUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={tocarLinkGoogle}
            >
              Dejar mi reseña en Google
            </a>
            {/* Deshabilitado hasta tocoGoogle: sistema de honor, pero con un empujón — el cliente
                tiene que pasar por el link antes de que este botón responda. Es un <button>
                (a diferencia del de arriba, que es un <a>), así que `disabled` alcanza: el
                navegador ya bloquea `onClick` solo, sin JS extra. Secundario (`btn-borde`), no un
                segundo principal: la acción principal de este paso es la reseña, y es la
                convención de la app (un principal + un borde). `width: 100%` porque `btn-borde` no
                lo trae y tiene que quedar alineado con el de arriba. */}
            <button
              className="btn-borde"
              type="button"
              style={{ marginTop: 10, width: '100%' }}
              disabled={!tocoGoogle}
              onClick={() => setContinuo(true)}
            >
              Ya la dejé, sacar mi tarjeta
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="stack">
        <p className="kicker reveal d1">{rotuloTarjeta(tipoTarjeta)}</p>
        <h1 className="title reveal d2">{nombreComercio}</h1>
        {/* El motivo para dejar el teléfono, en la mecánica de ESTA tarjeta. Antes prometía sumar
            puntos a los ocho tipos: a quien venía por una membresía se le prometía algo que su
            tarjeta no hace. */}
        <p className="lede reveal d2">
          {promesaRegistro(tipoTarjeta)} {fraseWalletDelFormulario(plataforma)}, sin apps y sin plásticos.
        </p>

        <form className="panel reveal d3" onSubmit={handleSubmit}>
          {/* Nombre y apellido por separado (0036): el pase los muestra en dos campos, NOMBRE y
              APELLIDO. El autocompletado es `given-name` / `family-name` y no `name`, que metía el
              nombre completo en "Nombre". El tope de 120 es el mismo que valida la ruta. */}
          <div className="field">
            <label htmlFor="nombre">Nombre</label>
            <input
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              autoComplete="given-name"
              maxLength={120}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="apellido">Apellido</label>
            <input
              id="apellido"
              value={apellido}
              onChange={(e) => setApellido(e.target.value)}
              placeholder="Tu apellido"
              autoComplete="family-name"
              maxLength={120}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pais">País</label>
            <select id="pais" value={clavePais} onChange={(e) => setClavePais(e.target.value)}>
              {PAISES.map((p) => (
                <option key={p.clave} value={p.clave}>
                  {p.bandera} {p.nombre} (+{p.codigo})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="telefono">Teléfono</label>
            {/* El ejemplo del placeholder cambia con el país: un salvadoreño viendo "55 1234 5678"
                no sabe si tiene que escribir su número con o sin código de área. */}
            <input
              id="telefono"
              type="tel"
              inputMode="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder={buscarPaisPorClave(clavePais)?.ejemplo ?? '7777 1234'}
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
            Solo usamos tu nombre, apellido y teléfono para identificar tu tarjeta.
          </p>
        </form>
      </div>
    </main>
  );
}
