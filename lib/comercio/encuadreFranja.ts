// lib/comercio/encuadreFranja.ts
// El ENCUADRE de la foto de fondo de la franja: qué parte de la foto se ve dentro del marco. Puro —
// sin DOM, sin React, sin sharp, sin next/og — porque lo consumen cinco dibujantes distintos: la vista
// previa del editor (CSS en el navegador), la franja del pass de Apple (next/og), la grilla de sellos
// y la portada de clase de Google (la misma composición) y el cartel (SVG). Una sola función decide;
// si cada uno hiciera su propia cuenta, el dueño vería un encuadre en la pantalla y otro en el
// teléfono.

export const MODOS_ENCUADRE = ['llenar', 'completa'] as const;
export type ModoEncuadre = (typeof MODOS_ENCUADRE)[number];

export interface Encuadre {
  // 'llenar': la foto cubre el marco y se recorta. 'completa': entra entera y el color de fondo de
  // la tarjeta rellena lo que sobra.
  modo: ModoEncuadre;
  // Enteros 0–100 con la semántica de object-position: dónde se alinea la holgura entre la foto
  // escalada y el marco. 50/50 es centrado.
  focoX: number;
  focoY: number;
  // Entero 100–300, en porcentaje sobre la escala base del modo.
  zoom: number;
}

export const ZOOM_MINIMO = 100;
export const ZOOM_MAXIMO = 300;

// Con el default TODO lo existente se ve exactamente igual que antes de que existiera el encuadre:
// es el `objectFit: 'cover'` centrado que la franja tuvo desde siempre.
export const ENCUADRE_POR_DEFECTO: Encuadre = { modo: 'llenar', focoX: 50, focoY: 50, zoom: 100 };

export interface Medidas {
  ancho: number;
  alto: number;
}

// El marco de la franja del pass de Apple, en puntos (@1x). Apple fija esta proporción.
export const MARCO_FRANJA: Medidas = { ancho: 375, alto: 123 };

// Dónde y a qué tamaño va la foto DENTRO del marco, en las unidades del marco.
export interface Colocacion {
  left: number;
  top: number;
  ancho: number;
  alto: number;
}

// Qué ventana de la FOTO (en píxeles de la foto) ocupa el marco entero. Puede ser más chica que la
// foto (recorte) o más grande (foto completa con fondo alrededor).
export interface Rectangulo {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

// naturalWidth/naturalHeight son 0 hasta que la imagen carga, y una foto corrupta puede medir 0.
// Dividir por eso da NaN/Infinity, y un NaN en una coordenada rompe el SVG del cartel entero.
function medidasValidas(m: Medidas): boolean {
  return m.ancho > 0 && m.alto > 0;
}

function escalaDe(foto: Medidas, marco: Medidas, encuadre: Encuadre): number {
  const porAncho = marco.ancho / foto.ancho;
  const porAlto = marco.alto / foto.alto;
  // 'llenar' escala por el lado que SOBRA (cover); 'completa' por el que FALTA (contain).
  const base = encuadre.modo === 'completa' ? Math.min(porAncho, porAlto) : Math.max(porAncho, porAlto);
  return (base * encuadre.zoom) / 100;
}

// EL cálculo. Todo lo demás deriva de acá.
export function colocarFoto(foto: Medidas, marco: Medidas, encuadre: Encuadre): Colocacion {
  if (!medidasValidas(foto) || !medidasValidas(marco)) {
    return { left: 0, top: 0, ancho: marco.ancho, alto: marco.alto };
  }
  const escala = escalaDe(foto, marco, encuadre);
  const ancho = foto.ancho * escala;
  const alto = foto.alto * escala;
  // La holgura (marco − foto escalada) es negativa cuando la foto desborda y positiva cuando le
  // falta; el foco la reparte igual en los dos casos, que es exactamente lo que hace object-position.
  return {
    left: ((marco.ancho - ancho) * encuadre.focoX) / 100,
    top: ((marco.alto - alto) * encuadre.focoY) / 100,
    ancho,
    alto,
  };
}

export function rectanguloVisible(foto: Medidas, marco: Medidas, encuadre: Encuadre): Rectangulo {
  if (!medidasValidas(foto) || !medidasValidas(marco)) {
    return { x: 0, y: 0, ancho: marco.ancho, alto: marco.alto };
  }
  const escala = escalaDe(foto, marco, encuadre);
  const c = colocarFoto(foto, marco, encuadre);
  return { x: -c.left / escala, y: -c.top / escala, ancho: marco.ancho / escala, alto: marco.alto / escala };
}

// Para la vista previa en el navegador: la colocación como porcentajes del marco, así el mismo
// cálculo sirve para un contenedor de cualquier ancho (responsive) sin medirlo.
export function porcentajesDeColocacion(c: Colocacion, marco: Medidas): Colocacion {
  return {
    left: (c.left / marco.ancho) * 100,
    top: (c.top / marco.alto) * 100,
    ancho: (c.ancho / marco.ancho) * 100,
    alto: (c.alto / marco.alto) * 100,
  };
}

function acotarFoco(valor: number): number {
  return Math.min(100, Math.max(0, valor));
}

// Por debajo de medio píxel de holgura la foto no puede moverse en ese eje, y dividir por algo tan
// chico mandaría el foco a un extremo con el mínimo temblor del dedo.
const HOLGURA_MINIMA_PX = 0.5;

// Arrastre en la vista previa: mover la foto `deltaPx` (píxeles de pantalla, INCREMENTALES desde el
// último pointermove) cambia el foco en `delta / holgura × 100`. El signo de la holgura hace que la
// foto siga al dedo tanto cuando desborda como cuando le falta. Devuelve floats acotados a 0–100: el
// componente redondea al soltar (redondear en cada movimiento perdería los desplazamientos chicos).
export function focoTrasArrastre(
  encuadre: Encuadre,
  deltaPx: { x: number; y: number },
  foto: Medidas,
  marcoPx: Medidas,
): { focoX: number; focoY: number } {
  if (!medidasValidas(foto) || !medidasValidas(marcoPx)) {
    return { focoX: encuadre.focoX, focoY: encuadre.focoY };
  }
  const c = colocarFoto(foto, marcoPx, encuadre);
  const holguraX = marcoPx.ancho - c.ancho;
  const holguraY = marcoPx.alto - c.alto;
  return {
    focoX: Math.abs(holguraX) < HOLGURA_MINIMA_PX ? encuadre.focoX : acotarFoco(encuadre.focoX + (deltaPx.x / holguraX) * 100),
    focoY: Math.abs(holguraY) < HOLGURA_MINIMA_PX ? encuadre.focoY : acotarFoco(encuadre.focoY + (deltaPx.y / holguraY) * 100),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación y lectura
// ─────────────────────────────────────────────────────────────────────────────

function esEnteroEntre(valor: number, minimo: number, maximo: number): boolean {
  return Number.isInteger(valor) && valor >= minimo && valor <= maximo;
}

// La BD solo tiene CHECKs baratos; esta es la defensa real. null = válido; string = mensaje al dueño.
export function validarEncuadre(e: { modo: string; focoX: number; focoY: number; zoom: number }): string | null {
  if (!(MODOS_ENCUADRE as readonly string[]).includes(e.modo)) return 'El modo de encuadre no es válido.';
  if (!esEnteroEntre(e.focoX, 0, 100)) return 'La posición horizontal debe ser un entero de 0 a 100.';
  if (!esEnteroEntre(e.focoY, 0, 100)) return 'La posición vertical debe ser un entero de 0 a 100.';
  if (!esEnteroEntre(e.zoom, ZOOM_MINIMO, ZOOM_MAXIMO)) return 'El zoom debe ser un entero de 100 a 300.';
  return null;
}

// Lo que llega del formulario (strings). Cuatro vacíos → null (el programa hereda). Si no, números
// crudos para que validarEncuadre los rechace con mensaje claro. Un vacío suelto va como NaN y NO
// como Number('') (que es 0, un foco válido): así el error no se traga.
export function encuadreDesdeFormulario(c: {
  modo: string;
  focoX: string;
  focoY: string;
  zoom: string;
}): { modo: string; focoX: number; focoY: number; zoom: number } | null {
  const aNumero = (v: string): number => (v.trim() === '' ? NaN : Number(v.trim()));
  if ([c.modo, c.focoX, c.focoY, c.zoom].every((v) => v.trim() === '')) return null;
  return { modo: c.modo.trim(), focoX: aNumero(c.focoX), focoY: aNumero(c.focoY), zoom: aNumero(c.zoom) };
}

// Lo que sale de la BD es dato hostil: un valor fuera de rango hace caer el encuadre ENTERO al
// default (se lee como unidad), nunca un campo "arreglado". Las cuatro columnas del comercio son
// NOT NULL, así que acá no hay null que contemplar.
export function encuadreDelComercio(fila: {
  encuadre_franja: string;
  foco_franja_x: number;
  foco_franja_y: number;
  zoom_franja: number;
}): Encuadre {
  const candidato = { modo: fila.encuadre_franja, focoX: fila.foco_franja_x, focoY: fila.foco_franja_y, zoom: fila.zoom_franja };
  if (validarEncuadre(candidato) !== null) return ENCUADRE_POR_DEFECTO;
  return { modo: candidato.modo as ModoEncuadre, focoX: candidato.focoX, focoY: candidato.focoY, zoom: candidato.zoom };
}

// En el programa las cuatro nacen null ("no lo toqué"). Una sola null → sin encuadre propio.
export function encuadreDelPrograma(fila: {
  encuadre_franja: string | null;
  foco_franja_x: number | null;
  foco_franja_y: number | null;
  zoom_franja: number | null;
}): Encuadre | null {
  if (
    fila.encuadre_franja === null ||
    fila.foco_franja_x === null ||
    fila.foco_franja_y === null ||
    fila.zoom_franja === null
  ) {
    return null;
  }
  return encuadreDelComercio({
    encuadre_franja: fila.encuadre_franja,
    foco_franja_x: fila.foco_franja_x,
    foco_franja_y: fila.foco_franja_y,
    zoom_franja: fila.zoom_franja,
  });
}
