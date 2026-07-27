import estilos from './inicio.module.css';
import type { ModeloTarjeta, Saldo } from './modelos';

// Dibuja una tarjeta de lealtad de mentira DENTRO de un teléfono, con la misma anatomía que el
// pass real (lib/apple/generatePass.ts + stripPass.tsx): logo y nombre del comercio arriba, la
// franja con el saldo al medio, dos campos de detalle y el código abajo.
//
// Todo el bloque va con aria-hidden desde el carrusel: es una ilustración. La descripción para
// lectores de pantalla la pone descripcionDeModelo().

// Una estrella de cinco puntas en una caja de 24×24, para los comercios que usan sello con forma
// en vez del aro clásico.
const ESTRELLA = 'M12 2.6 14.85 8.9 21.6 9.7 16.6 14.3 17.95 21 12 17.6 6.05 21 7.4 14.3 2.4 9.7 9.15 8.9Z';

function Sello({ lleno, forma, colorLabel, colorFondo }: {
  lleno: boolean;
  forma: 'estrella' | 'circulo';
  colorLabel: string;
  colorFondo: string;
}) {
  if (forma === 'estrella') {
    return (
      <svg className={estilos.sello} viewBox="0 0 24 24">
        <path
          d={ESTRELLA}
          fill={lleno ? colorLabel : 'none'}
          stroke={lleno ? colorLabel : 'currentColor'}
          strokeWidth="1.6"
          strokeLinejoin="round"
          // El pendiente se ve APAGADO, no ausente: así se lee cuánto falta, que es justo el
          // gancho de una tarjeta de sellos.
          opacity={lleno ? 1 : 0.4}
        />
      </svg>
    );
  }
  return (
    <span
      className={estilos.sello}
      style={{
        borderColor: lleno ? colorLabel : 'currentColor',
        background: lleno ? colorLabel : 'transparent',
        opacity: lleno ? 1 : 0.4,
      }}
    >
      {lleno && <span className={estilos.selloPunto} style={{ background: colorFondo }} />}
    </span>
  );
}

function Franja({ saldo, colorLabel, colorFondo }: {
  saldo: Saldo;
  colorLabel: string;
  colorFondo: string;
}) {
  if (saldo.tipo === 'puntos') {
    return (
      <div className={estilos.franja}>
        {/* Los dos resplandores del color de marca son los mismos que compone bandaMarca() para
            el pass de verdad: dan textura sin pelear con el número. */}
        <span className={estilos.resplandor} style={{ background: colorLabel }} />
        <span className={estilos.resplandorChico} style={{ background: colorLabel }} />
        <b className={estilos.numeroPuntos}>{saldo.total}</b>
        <small className={estilos.etiquetaPuntos} style={{ color: colorLabel }}>
          puntos
        </small>
      </div>
    );
  }

  // Misma regla que stripPass.tsx: pasando de 6 sellos se parte en dos filas, porque una sola fila
  // apretada deja círculos diminutos y a merced del recorte.
  const filas = saldo.meta > 6 ? 2 : 1;
  const porFila = Math.ceil(saldo.meta / filas);
  const todos = Array.from({ length: saldo.meta }, (_, i) => i);

  return (
    <div className={estilos.franja}>
      <div className={estilos.grilla}>
        {Array.from({ length: filas }, (_, fila) => (
          <div key={fila} className={estilos.filaSellos}>
            {todos.slice(fila * porFila, (fila + 1) * porFila).map((i) => (
              <Sello
                key={i}
                lleno={i < saldo.llenos}
                forma={saldo.forma ?? 'circulo'}
                colorLabel={colorLabel}
                colorFondo={colorFondo}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ¿Cae este módulo dentro de uno de los tres cuadros de localización del código? Esos van dibujados
// aparte, con su forma fija.
function esLocalizador(fila: number, columna: number, lado: number): boolean {
  const arriba = fila < 3;
  const abajo = fila >= lado - 3;
  const izquierda = columna < 3;
  const derecha = columna >= lado - 3;
  return (arriba && izquierda) || (arriba && derecha) || (abajo && izquierda);
}

function CodigoQr({ semilla }: { semilla: number }) {
  const lado = 9;
  const modulos: [number, number][] = [];
  for (let fila = 0; fila < lado; fila++) {
    for (let columna = 0; columna < lado; columna++) {
      if (esLocalizador(fila, columna, lado)) continue;
      // Patrón DETERMINISTA a propósito: con Math.random() el servidor y el navegador dibujarían
      // códigos distintos y React reportaría un desajuste de hidratación en la página de entrada.
      if (((fila + 2) * (columna + 3) + semilla * 7) % 5 < 2) modulos.push([fila, columna]);
    }
  }
  return (
    <svg className={estilos.qr} viewBox={`0 0 ${lado} ${lado}`}>
      {modulos.map(([fila, columna]) => (
        <rect key={`${fila}-${columna}`} x={columna} y={fila} width="1" height="1" />
      ))}
      {([[0, 0], [0, lado - 3], [lado - 3, 0]] as [number, number][]).map(([fila, columna]) => (
        <g key={`loc-${fila}-${columna}`}>
          <rect
            x={columna + 0.35}
            y={fila + 0.35}
            width="2.3"
            height="2.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
          />
          <rect x={columna + 1} y={fila + 1} width="1" height="1" />
        </g>
      ))}
    </svg>
  );
}

export function TarjetaModelo({ modelo, semilla }: { modelo: ModeloTarjeta; semilla: number }) {
  return (
    <div className={estilos.telefono}>
      <span className={estilos.isla} />
      <div className={estilos.pantalla}>
        <div
          className={estilos.pase}
          style={{ background: modelo.colorFondo, color: modelo.colorTexto }}
        >
          <div className={estilos.paseCabecera}>
            <span
              className={estilos.paseLogo}
              style={{ background: modelo.colorLabel, color: modelo.colorFondo }}
            >
              {modelo.inicial}
            </span>
            <span className={estilos.paseNombre}>{modelo.negocio}</span>
            <span className={estilos.paseTipo} style={{ color: modelo.colorLabel }}>
              {modelo.saldo.tipo === 'sellos' ? 'Sellos' : 'Puntos'}
            </span>
          </div>

          <Franja
            saldo={modelo.saldo}
            colorLabel={modelo.colorLabel}
            colorFondo={modelo.colorFondo}
          />

          <p className={estilos.paseNota}>{modelo.nota}</p>

          <div className={estilos.paseCampos}>
            <span className={estilos.paseCampo}>
              <small style={{ color: modelo.colorLabel }}>Miembro</small>
              <b>{modelo.miembro}</b>
            </span>
            <span className={`${estilos.paseCampo} ${estilos.paseCampoDerecha}`}>
              <small style={{ color: modelo.colorLabel }}>Próximo premio</small>
              <b>{modelo.premio}</b>
            </span>
          </div>

          <div className={estilos.paseCodigo}>
            <CodigoQr semilla={semilla} />
          </div>
        </div>

        {/* Debajo del pase queda pantalla vacía. La barrita del final es el indicador de inicio:
            dice "esto es un teléfono" sin una sola palabra.
            El aparato va en CLARO (ver .telefono en el módulo de estilos). La billetera de verdad
            es negra incluso con el sistema en claro, así que esto no es un calco: es que sobre el
            campo de brasa un teléfono negro se hundía en el fondo y se perdía la mitad de arriba.
            Lo que sí es fiel es la tarjeta, que conserva los colores del comercio. */}
        <span className={estilos.espacio} />
        <span className={estilos.barraInicio} />
      </div>
    </div>
  );
}
