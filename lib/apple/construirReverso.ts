import { EMISOR_CARDLY } from './emisorCardly';

// Arma los campos del REVERSO del pass (los backFields que ve el cliente al tocar la "i").
//
// Función PURA a propósito: recibe datos planos y devuelve campos, sin tocar Supabase. Ahí vive
// casi todo el riesgo del reverso (singular/plural, secciones que se omiten, orden, escape) y así
// se puede probar exhaustivamente sin base de datos. Las consultas viven en datosPassDeTarjeta.

export interface CampoReverso {
  key: string;
  label: string;
  // SIEMPRE presente. `value` es .required() en el esquema Joi de passkit-generator
  // (schemas/PassFieldContent.js) y FieldsArray ATRAPA el error de validación y descarta el campo
  // con un console.warn, SIN lanzar (FieldsArray.js, registerWithValidation). Un campo armado solo
  // con attributedValue no aparece en el pass y no falla nada: se pierde en silencio.
  value: string;
  attributedValue?: string;
}

export interface ReglaReverso {
  tipo: string;
  valor: number;
  activa_desde: string;
}

export interface RecompensaReverso {
  nombre: string;
  descripcion: string | null;
  costo_puntos: number;
}

export interface DatosReverso {
  nombreComercio: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  mostrarComoFunciona: boolean;
  terminosUso: string | null;
  redInstagram: string | null;
  redFacebook: string | null;
  redWhatsapp: string | null;
  sitioWeb: string | null;
  reglas: ReglaReverso[];
  // Llegan YA filtradas (`activa = true`) y YA ordenadas por costo_puntos ascendente: las dos cosas
  // las hace quien consulta (datosPassDeTarjeta). Esta funcion RESPETA el orden que recibe y no
  // reordena — si ordenara acá tambien, el orden quedaria definido en dos lugares que pueden
  // discrepar. Y re-filtrar no podria aunque quisiera: no recibe el campo `activa`.
  recompensas: RecompensaReverso[];
}

// `&` PRIMERO, siempre. Si se reemplazara `<` antes que `&`, el `&` de `&lt;` se volvería a
// escapar y saldría `&amp;lt;` — el texto quedaría visible como basura en la tarjeta del cliente.
export function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// 'sellos' → sello/sellos; cualquier otro tipo de tarjeta → punto/puntos. Singular SOLO cuando la
// cantidad es exactamente 1 (0.5 y 2 son plural), tanto en las líneas de reglas como en las de
// recompensas.
function unidad(tipoTarjeta: string, cantidad: number): string {
  if (tipoTarjeta === 'sellos') return cantidad === 1 ? 'sello' : 'sellos';
  return cantidad === 1 ? 'punto' : 'puntos';
}

// `Number()` antes de `String()` colapsa los ceros de relleno de un numeric de Postgres: '1.00' → 1
// → "1", y 0.50 → "0.5". El tipo dice number, pero el paso por Number() también cubre el caso de
// que PostgREST entregue el numeric como cadena.
function formatearValor(n: number): string {
  return String(Number(n));
}

// reglas_puntos NO tiene unique por tipo: crearRegla no deduplica y el panel las lista todas, así
// que un comercio con tres filas `por_visita` imprimiría tres líneas contradictorias en la tarjeta
// del cliente. Se emite UNA por tipo, la de activa_desde mayor; las viejas son historial, no
// política vigente.
//
// Compara INSTANTES (getTime()) y no cadenas: activa_desde es timestamptz y dos filas con offsets
// distintos ('…+00:00' vs '…-06:00') se ordenan mal como texto.
function reglaVigenteDeTipo(reglas: ReglaReverso[], tipo: string): ReglaReverso | null {
  let vigente: ReglaReverso | null = null;
  for (const regla of reglas) {
    if (regla.tipo !== tipo) continue;
    if (vigente === null || new Date(regla.activa_desde).getTime() > new Date(vigente.activa_desde).getTime()) {
      vigente = regla;
    }
  }
  return vigente;
}

// `value` SIEMPRE, con la URL CRUDA: es lo que el cliente ve si por lo que sea el link no se
// renderiza (degradación legible, no un campo mudo) — y sin él passkit descarta el campo entero.
// El href se escapa porque attributedValue se interpreta como HTML y la URL la escribió el dueño:
// sin escape, una comilla cierra el atributo antes de tiempo e inyecta marcado. La etiqueta no se
// escapa porque es una constante de este archivo, no texto de usuario.
function campoLink(key: string, label: string, url: string): CampoReverso {
  return {
    key,
    label,
    value: url,
    attributedValue: `<a href="${escaparHtml(url)}">${label}</a>`,
  };
}

// Vacío o solo-espacios cuenta como ausente: guardarReverso ya normaliza a null, pero una fila
// vieja con '' produciría un campo con la etiqueta y el valor en blanco en la tarjeta del cliente.
function hayTexto(valor: string | null): valor is string {
  return valor !== null && valor.trim() !== '';
}

// Las líneas de "Cómo funciona", en el orden del spec §4: por_visita, por_monto, meta de sellos y
// después las recompensas. Devuelve [] cuando no hay nada que decir.
function lineasComoFunciona(datos: DatosReverso): string[] {
  const lineas: string[] = [];

  const porVisita = reglaVigenteDeTipo(datos.reglas, 'por_visita');
  if (porVisita) {
    lineas.push(`Ganás ${formatearValor(porVisita.valor)} ${unidad(datos.tipoTarjeta, porVisita.valor)} por cada visita.`);
  }

  const porMonto = reglaVigenteDeTipo(datos.reglas, 'por_monto');
  if (porMonto) {
    // "por cada $1 de compra" sale de la etiqueta del formulario que llena el dueño
    // (FormularioRegla.tsx). El sistema NO calcula nada: las reglas son declarativas (el cajero
    // digita el delta a mano), así que esa etiqueta es la ÚNICA fuente de verdad del significado.
    lineas.push(`Ganás ${formatearValor(porMonto.valor)} ${unidad(datos.tipoTarjeta, porMonto.valor)} por cada $1 de compra.`);
  }

  // La meta es un COMPLEMENTO de las otras líneas, nunca un motivo para emitir la sección:
  // "Completá tus 10 sellos." a solas, sin decir cómo se consigue uno ni qué se gana al
  // completarlos, no le sirve a nadie. Por eso exige que ya haya alguna línea.
  // El `> 0` no es defensa contra la BD (la 0005 tiene `check (sello_meta is null or sello_meta > 0)`)
  // sino simetría con generatePass.ts, que decide `esSellos` con la misma condición: dos archivos
  // hermanos que miran el mismo campo con criterios distintos es una divergencia esperando a pasar.
  // Y si algún día se cayera ese CHECK, "Completá tus 0 sellos." sería una línea absurda en la
  // tarjeta de un cliente.
  if (datos.tipoTarjeta === 'sellos' && datos.selloMeta !== null && datos.selloMeta > 0 && lineas.length > 0) {
    lineas.push(`Completá tus ${datos.selloMeta} ${unidad(datos.tipoTarjeta, datos.selloMeta)}.`);
  }

  for (const recompensa of datos.recompensas) {
    lineas.push(`• ${recompensa.nombre} — ${recompensa.costo_puntos} ${unidad(datos.tipoTarjeta, recompensa.costo_puntos)}`);
    // La descripción va en la línea siguiente: son las palabras del propio dueño.
    if (hayTexto(recompensa.descripcion)) lineas.push(recompensa.descripcion);
  }

  return lineas;
}

export function construirReverso(datos: DatosReverso): CampoReverso[] {
  const campos: CampoReverso[] = [];

  // 1. Cómo funciona — se arma en CADA generación del pass leyendo la base, nunca se congela una
  // copia: un reverso que promete una recompensa que ya cambió es una promesa incumplida frente al
  // cliente final. Va en `value` (texto plano) y no en attributedValue: contiene texto del dueño
  // (recompensas.nombre/descripcion) sin escapar y no necesita links.
  if (datos.mostrarComoFunciona) {
    const lineas = lineasComoFunciona(datos);
    // Sin reglas vigentes Y sin recompensas activas no hay nada que decir, y un encabezado
    // "Cómo funciona" seguido de nada es peor que su ausencia.
    if (lineas.length > 0) {
      campos.push({ key: 'como_funciona', label: 'Cómo funciona', value: lineas.join('\n') });
    }
  }

  // 2. Términos de uso — texto libre del dueño, tal cual lo escribió.
  if (hayTexto(datos.terminosUso)) {
    campos.push({ key: 'terminos', label: 'Términos de uso', value: datos.terminosUso });
  }

  // 3-6. Redes y sitio, cada una un link tocable. La que no tiene dato desaparece entera.
  if (hayTexto(datos.redInstagram)) campos.push(campoLink('instagram', 'Instagram', datos.redInstagram));
  if (hayTexto(datos.redFacebook)) campos.push(campoLink('facebook', 'Facebook', datos.redFacebook));
  if (hayTexto(datos.redWhatsapp)) campos.push(campoLink('whatsapp', 'WhatsApp', datos.redWhatsapp));
  if (hayTexto(datos.sitioWeb)) campos.push(campoLink('sitio', 'Sitio web', datos.sitioWeb));

  // 7. El nombre del comercio, SIEMPRE.
  campos.push({ key: 'empresa', label: 'Nombre de empresa', value: datos.nombreComercio });

  // 8. El pie de Cardly, SIEMPRE y en todos los comercios (sin excepción por plan). Las tres líneas
  // van en `value` separadas por \n porque el attributedValue de Apple solo admite <a> — no <br> ni
  // marcado de bloque, así que no hay forma de apilarlas ahí.
  //
  // dataDetectorTypes se OMITE deliberadamente: omitir la clave deja ACTIVOS todos los detectores
  // de iOS, mientras que fijarla los RESTRINGE a los listados. Poner ['PKDataDetectorTypeLink']
  // arriesgaría que el correo no caiga en esa categoría y quede como texto muerto — y el esquema
  // Joi lo acepta sin chistar, así que se descubriría recién en un iPhone.
  campos.push({
    key: 'emisor',
    label: 'Información del emisor',
    value: `${EMISOR_CARDLY.nombre}\n${EMISOR_CARDLY.correo}\n${EMISOR_CARDLY.sitio}`,
  });

  return campos;
}
