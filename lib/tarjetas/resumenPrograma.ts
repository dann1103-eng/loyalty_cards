import { formatearCentavos, nivelParaAcumulado, sigueVigente, tipoOPuntos } from './tipos';
import { unidadPara, unidadPrograma } from './unidadPrograma';
import { COLUMNAS_ESTADO, type FilaEstado, type NivelDeDescuento } from './estadoTarjeta';

// El AGREGADO del panel del dueño: qué dice la carta grande de métricas, por programa y en el
// idioma de su tipo.
//
// ══ POR QUÉ EXISTE ══
// El panel sumaba `puntos_actuales` de TODAS las tarjetas del comercio, sin mirar el tipo de cada
// programa, y rotulaba el total con `esSellos ? 'Sellos vigentes' : 'Puntos vigentes'`. Eso le
// mostraba al dueño:
//
//   membresía   → "PUNTOS VIGENTES 0"   (el contador es 'ninguno': ese cero no significa NADA)
//   gift card   → "125000 puntos"       (la columna son CENTAVOS: $1 250.00 circulantes)
//   dos tipos   → sellos + centavos     (un número que no es interpretable en ninguna unidad)
//
// Es el mismo defecto que ya cerraron `formatearSaldo` → `describirFila` y `unidadPrograma`: una
// firma que no podía expresar el caso. Y acá NO alcanza con una etiqueta mejor — un número que suma
// centavos con sellos no tiene etiqueta correcta. Por eso el agregado se PARTE por programa y cada
// familia de tipo trae su propia PREGUNTA:
//
//   contador 'entero'   (puntos, sellos, prepago)  → la suma, en su unidad     "1240 sellos"
//   contador 'centavos' (gift card, cashback)      → la suma en dinero         "$1250.00"
//   usaVigencia         (membresía, cupón)         → cuántas siguen vigentes   "12 activas · de 15"
//   descuento                                      → cuántos alcanzaron nivel  "8 con descuento · de 40"
//
// `describirFila` NO sirve para esto: describe UNA tarjeta, no un agregado.
//
// Para una membresía "cuántos socios activos tengo" es LA métrica del negocio, así que la carta no
// se esconde: cambia de pregunta.

// Las columnas de `tarjetas` que necesita el panel. Viajan JUNTO a la función que las lee, igual que
// COLUMNAS_ESTADO en estadoTarjeta.ts: `programa_id` es por donde se agrupa y no está en esa
// constante, así que un `select` que se quede corto rompe el agrupamiento sin que se note.
export const COLUMNAS_RESUMEN = `${COLUMNAS_ESTADO}, programa_id`;

export interface FilaResumen extends FilaEstado {
  programa_id: string;
}

// Estructural a propósito: `Programa` (lib/comercio/programas.ts) lo satisface, pero este módulo es
// PURO y no debe arrastrar la capa de datos.
export interface ProgramaDelResumen {
  id: string;
  nombre: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  activo: boolean;
}

export interface CartaResumen {
  programaId: string;
  // El nombre solo se muestra cuando hay MÁS DE UN programa activo: con uno solo sería ruido, porque
  // el programa principal nace llamándose como el comercio (0024).
  nombre: string | null;
  // El encabezado de la carta: la PREGUNTA que responde este tipo.
  etiqueta: string;
  // El número, solo. Es lo que la carta dibuja en grande (.metric-valor, 2.9rem mono).
  valor: string;
  // La palabra que lo acompaña, en chico y en la misma línea. Cadena vacía en la familia 'centavos':
  // ahí el valor ya es dinero ("$25.00") y ponerle una palabra al lado es el bug de origen.
  unidad: string;
  detalle: string;
}

// La línea completa, tal como la lee el dueño. La carta la parte en dos tamaños —el número grande y
// la palabra chica— porque "8 con descuento" a 2.9rem se sale de la carta; pero el texto visible
// tiene que tener UN solo dueño, y es este.
export function textoCarta(carta: Pick<CartaResumen, 'valor' | 'unidad'>): string {
  return carta.unidad ? `${carta.valor} ${carta.unidad}` : carta.valor;
}

// Cuántas tarjetas de un cupón siguen disponibles, y por qué no es la misma regla que la membresía:
// `describirSaldo` ya fija la semántica de cada tipo y acá se respeta al pie.
//   - cupón usado ⇒ 'Ya usado', esté como esté la fecha.
//   - cupón SIN fecha ⇒ 'Disponible': no vence nunca, y es una decisión válida del dueño
//     (vencimientoInicialCupon devuelve null cuando no hay plazo configurado).
//   - membresía SIN fecha ⇒ 'Sin activar': no es socio todavía.
// `sigueVigente(null)` devuelve false, así que aplicarle la misma línea a los dos tipos dejaría los
// cupones sin vencimiento contados como vencidos.
function estaVigente(fila: FilaResumen, tipoValor: string, hoyIso: string): boolean {
  if (tipoValor === 'cupon') {
    if (fila.usado_en) return false;
    return fila.vigencia_hasta === null || sigueVigente(fila.vigencia_hasta, hoyIso);
  }
  return sigueVigente(fila.vigencia_hasta, hoyIso);
}

function cartaDePrograma(
  programa: ProgramaDelResumen,
  filas: FilaResumen[],
  niveles: NivelDeDescuento[],
  hoyIso: string,
): Omit<CartaResumen, 'nombre' | 'programaId'> {
  const tipo = tipoOPuntos(programa.tipoTarjeta);
  const total = filas.length;

  // El nivel se calcula al LEER, nunca se guarda (lib/tarjetas/descuento.ts): cambiar los umbrales
  // tiene que reordenar a todos los clientes de inmediato. Los niveles son del COMERCIO, no del
  // programa, y por eso entran por argumento una sola vez.
  if (tipo.valor === 'descuento') {
    const conDescuento = filas.filter(
      (f) => nivelParaAcumulado(Number(f.acumulado_centavos ?? 0), niveles) !== null,
    ).length;
    return {
      etiqueta: 'Clientes con descuento',
      valor: String(conDescuento),
      unidad: 'con descuento',
      detalle: `de ${total}`,
    };
  }

  if (tipo.usaVigencia) {
    const vigentes = filas.filter((f) => estaVigente(f, tipo.valor, hoyIso)).length;
    const palabra =
      tipo.valor === 'membresia'
        ? vigentes === 1
          ? 'activa'
          : 'activas'
        : vigentes === 1
          ? 'vigente'
          : 'vigentes';
    return {
      etiqueta: tipo.valor === 'membresia' ? 'Socios activos' : 'Cupones vigentes',
      valor: String(vigentes),
      unidad: palabra,
      detalle: `de ${total}`,
    };
  }

  const suma = filas.reduce((acumulado, f) => acumulado + (f.puntos_actuales ?? 0), 0);

  if (tipo.contador === 'centavos') {
    // La rama del bug de origen: acá el entero son CENTAVOS. Devolverlo crudo escribe "2500" sobre
    // una gift card de $25.00, que es el "2500 puntos" del 2026-07-30 con otra ropa.
    return {
      etiqueta: 'Saldo en tarjetas',
      valor: formatearCentavos(suma),
      unidad: '',
      detalle: 'saldo circulante',
    };
  }

  // contador 'entero': la unidad la DERIVA unidadPrograma del catálogo, así que un tipo nuevo no
  // puede heredar "puntos" por descuido.
  const unidad = unidadPrograma(tipo.valor);
  const plural = unidad?.plural ?? 'puntos';
  return {
    etiqueta: `${plural[0].toUpperCase()}${plural.slice(1)} vigentes`,
    valor: String(suma),
    // unidadPara y no `plural` pelado: con exactamente uno va en singular ("1 punto", no "1 puntos").
    unidad: unidadPara(tipo.valor, suma) ?? plural,
    // Las visitas de un prepago no se canjean: se usan.
    detalle: tipo.valor === 'prepago' ? 'sin usar' : 'sin canjear',
  };
}

// Una carta por programa ACTIVO. `null` = no hay carta que dibujar.
//
// El `null` del comercio sin ninguna tarjeta es una decisión del spec, no un descuido: justo arriba
// está el tutorial de primeros pasos, que es lo que ese dueño necesita. Una carta que dice cero no
// le dice qué hacer — el mismo criterio con el que hoy el tutorial va ANTES que las métricas.
//
// Un programa activo sin tarjetas propias SÍ tiene carta (en cero) mientras el comercio tenga alguna:
// ahí el dueño ya pasó el tutorial y esconderle una de sus dos cartas lo dejaría preguntándose dónde
// quedó el programa que acaba de crear.
export function resumenPrograma(
  programas: ProgramaDelResumen[],
  filas: FilaResumen[],
  niveles: NivelDeDescuento[],
  hoyIso: string,
): CartaResumen[] | null {
  if (filas.length === 0) return null;

  const activos = programas.filter((p) => p.activo);
  if (activos.length === 0) return null;

  return activos.map((p) => ({
    programaId: p.id,
    nombre: activos.length > 1 ? p.nombre : null,
    ...cartaDePrograma(
      p,
      filas.filter((f) => f.programa_id === p.id),
      niveles,
      hoyIso,
    ),
  }));
}
