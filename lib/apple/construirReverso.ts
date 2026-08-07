import { EMISOR_CARDLY } from './emisorCardly';
import { unidadPara, describirCosto } from '../tarjetas/unidadPrograma';

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
  changeMessage?: string;
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
  // Mensaje de campaña o de inactividad YA RESUELTO (resolverAviso) — construirReverso no sabe de
  // fechas, solo dibuja lo que le llega. null = sin aviso vigente, el campo no se emite.
  avisoTexto: string | null;
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

// Acá vivía un `unidad()` propio que hacía `tipo === 'sellos' ? 'sellos' : 'puntos'`, o sea que los
// otros SEIS tipos se llamaban "puntos" en el reverso de la tarjeta del cliente: alguien con una
// gift card leía "Ganás 1 punto por cada visita", y alguien de prepago veía sus visitas descritas
// como puntos. Se reemplazó por `unidadPara` (lib/tarjetas/unidadPrograma.ts), que deriva la palabra
// del catálogo y devuelve null donde no hay unidad que nombrar — ver el encabezado de ese módulo.

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
//
// `!= null` (no `!== null`) A PROPÓSITO: descarta null Y undefined. El tipo declara `string | null`
// porque ningún llamador bien tipado debería pasar undefined — pero un llamador de JS que todavía
// no conoce un campo nuevo (p. ej. datosPassDeTarjeta.ts con avisoTexto, antes de que ese archivo
// se actualice) sí puede, y esta función no puede reventar el reverso ENTERO por eso.
function hayTexto(valor: string | null): valor is string {
  return valor != null && valor.trim() !== '';
}

// Si el aviso (campaña o inactividad — ver docs/superpowers/specs/2026-07-29-notificaciones-push-design.md)
// sigue vigente HOY. Se compara como TEXTO, igual que la vigencia de un cupón: "hasta el 29" es
// el 29 completo en el local, y comparar instantes lo mataría a medianoche UTC.
export function resolverAviso(
  texto: string | null,
  hasta: string | null,
  hoyIso: string,
): string | null {
  if (texto === null || hasta === null) return null;
  return hasta.slice(0, 10) >= hoyIso.slice(0, 10) ? texto : null;
}

// Las líneas de "Cómo funciona", en el orden del spec §4: por_visita, por_monto, meta de sellos y
// después las recompensas. Devuelve [] cuando no hay nada que decir.
function lineasComoFunciona(datos: DatosReverso): string[] {
  const lineas: string[] = [];

  // Las reglas de `reglas_puntos` describen cuántos sellos/puntos/visitas se ganan, así que SOLO
  // tienen sentido en los tipos que cuentan enteros. En una gift card o un cashback el número que
  // sube son centavos —lo que se gana ahí lo define el porcentaje del programa, no estas reglas— y
  // en cupón/membresía/descuento no hay contador. Antes se imprimían igual, con la palabra
  // "puntos" pegada: "Ganás 1 punto por cada visita" en la tarjeta de alguien con saldo en dólares.
  // Ahora esas líneas simplemente no se emiten, que es lo honesto.
  const porVisita = reglaVigenteDeTipo(datos.reglas, 'por_visita');
  if (porVisita) {
    const u = unidadPara(datos.tipoTarjeta, porVisita.valor);
    if (u) lineas.push(`Ganás ${formatearValor(porVisita.valor)} ${u} por cada visita.`);
  }

  const porMonto = reglaVigenteDeTipo(datos.reglas, 'por_monto');
  if (porMonto) {
    // "por cada $1 de compra" sale de la etiqueta del formulario que llena el dueño
    // (FormularioRegla.tsx). El sistema NO calcula nada: las reglas son declarativas (el cajero
    // digita el delta a mano), así que esa etiqueta es la ÚNICA fuente de verdad del significado.
    const u = unidadPara(datos.tipoTarjeta, porMonto.valor);
    if (u) lineas.push(`Ganás ${formatearValor(porMonto.valor)} ${u} por cada $1 de compra.`);
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
    lineas.push(`Completá tus ${datos.selloMeta} ${unidadPara('sellos', datos.selloMeta)}.`);
  }

  for (const recompensa of datos.recompensas) {
    const costo = describirCosto(datos.tipoTarjeta, recompensa.costo_puntos);
    lineas.push(costo ? `• ${recompensa.nombre} — ${costo}` : `• ${recompensa.nombre}`);
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

  // 9. Aviso de campaña o inactividad (migración 0026). Va AL FINAL a propósito, después del pie
  // fijo: es la sección más nueva y más cambiante, y el orden del resto del reverso no debe
  // saltar cada vez que un aviso aparece o desaparece. changeMessage con "%@" es lo único que
  // convierte un cambio de VALOR de este campo en un aviso visible en la pantalla de bloqueo —
  // ver la sección "La asimetría de plataforma" del spec. El límite de caracteres reales de este
  // campo (a diferencia de relevantText, que sí está medido) todavía no se verificó contra Wallet
  // real — hacerlo es parte de la Task 4 de este plan, antes de dar por buena esta sección.
  if (hayTexto(datos.avisoTexto)) {
    campos.push({
      key: 'aviso',
      label: 'Aviso',
      value: datos.avisoTexto,
      changeMessage: '%@',
    });
  }

  return campos;
}
