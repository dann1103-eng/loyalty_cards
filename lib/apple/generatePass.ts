import { PKPass } from 'passkit-generator';
import path from 'node:path';
import { requireEnv } from '@/lib/env';
import { componerStrips, descargarImagen } from './stripPass';
import { redimensionarLogo } from './imagenesPass';
import type { CampoReverso } from './construirReverso';
import { frentePase, PIE_CODIGO, type Franja } from '@/lib/tarjetas/frentePase';
import type { Encuadre } from '@/lib/comercio/encuadreFranja';
import {
  MAXIMO_UBICACIONES_APPLE,
  LARGO_MAXIMO_MENSAJE_CERCANIA,
  type UbicacionGeopush,
} from '@/lib/comercio/geopush';

// Radio del aviso por cercanía, en metros. 100 es lo que pidió el dueño y coincide con lo que iOS
// usa en la práctica para tarjetas de lealtad: Apple trata maxDistance como una SUGERENCIA y ya
// aplica ~100 m a los store cards, así que pedir más no ensancha el radio real. Además suma la
// horizontalAccuracy del GPS del momento, o sea que el radio efectivo es algo mayor.
const RADIO_GEOPUSH_METROS = 100;

function cargarCertificados() {
  return {
    wwdr: Buffer.from(requireEnv('APPLE_WWDR_B64'), 'base64'),
    signerCert: Buffer.from(requireEnv('APPLE_SIGNER_CERT_B64'), 'base64').toString('utf-8'),
    signerKey: Buffer.from(requireEnv('APPLE_SIGNER_KEY_B64'), 'base64').toString('utf-8'),
  };
}

// Qué hay DE VERDAD en la franja de ESTE pase (spec 2026-09-17, "La franja, en tres estados"). Se
// decide con `hayStrips` —si componerStrips devolvió algo— y no solo con lo que subió el comercio:
// si la franja propia no se pudo bajar, el pase sale SIN franja, y tratarlo como 'propia' lo dejaría
// también sin el nombre del pase hasta la próxima operación del cliente.
function franjaDelPase(
  d: { tipoTarjeta: string; selloMeta: number | null; stripUrl: string | null },
  hayStrips: boolean,
): Franja {
  if (d.stripUrl && hayStrips) return 'propia';
  // Misma condición de grilla que usa stripPass para componerla.
  const sellosConMeta = d.tipoTarjeta === 'sellos' && d.selloMeta != null && d.selloMeta > 0;
  if (sellosConMeta && !d.stripUrl && hayStrips) return 'grilla';
  return 'banda';
}

export interface DatosPass {
  serialNumber: string;
  qrToken: string;
  puntos: number;
  // Titular de la tarjeta: NOMBRE a la izquierda y APELLIDO a la derecha, debajo de la franja.
  // `clientes.nombre`: null si no se pudo resolver, y entonces el pass sale sin NINGUNO de los dos
  // (un APELLIDO solo no nombra a nadie).
  nombreCliente: string | null;
  // `clientes.apellido` (0036). null en los clientes registrados antes de la 0036 y en los que se
  // dieron de alta por teléfono sin apellido: el pass sale solo con NOMBRE.
  apellidoCliente: string | null;
  nombreComercio: string;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  webServiceURL: string;
  authenticationToken: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  // `tarjetas.vigencia_hasta` (AAAA-MM-DD) y `tarjetas.usado_en`: el estado de un cupón o una
  // membresía es una FECHA, no un número, y sin ellos el frente de esos dos tipos salía VACÍO
  // —solo logo, franja y nombre del cliente— mientras el borrador de términos que la app genera
  // prometía "hasta la fecha que aparece en la tarjeta".
  //
  // OJO, asimetría conocida con Google y documentada a propósito: acá NO se manda `expirationDate`
  // (fuera de alcance), así que iOS no marca el pase como vencido; el texto se refresca cuando
  // llega el push, que hoy ocurre al OPERAR la tarjeta. O sea que el pase de una membresía vencida
  // va a seguir diciendo "VÁLIDO HASTA 03/08/2026" hasta el próximo escaneo. Es
  // aceptable —el cajero ve el estado real al escanear— pero tiene que estar escrito.
  vigenciaHasta: string | null;
  usadoEn: string | null;
  // `programas_tarjeta.nombre_pase`: cómo se llama la tarjeta para el cliente. Se escribe SOBRE la
  // franja, y solo cuando la franja es la banda lisa (ver `franjaDelPase`). null = nada encima.
  nombrePase: string | null;
  // El "hoy" del COMERCIO (hoyEnZona(comercio.zona_horaria)), no el del servidor: decide si la
  // membresía dice "VÁLIDO HASTA" o "VENCIÓ EL", y con UTC el borde se corre un día entero.
  hoyIso: string;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  difuminadoFranja: string;
  // Qué parte de la foto de la franja se ve (migración 0032). OBLIGATORIO por el mismo motivo que
  // `reverso` y `ubicaciones`: si fuera opcional, una ruta de emisión nueva dibujaría la foto con
  // el encuadre por defecto y nadie se enteraría.
  encuadreFranja: Encuadre;
  // Campos del reverso del pass, ya armados por construirReverso. Arreglo vacio = pass sin reverso
  // (es lo que pasa si las consultas de reglas/recompensas fallan: best-effort, ver datosPassDeTarjeta).
  //
  // OBLIGATORIO a proposito, no `reverso?:`: hacerlo opcional dejaria que una ruta de emision nueva
  // arme un pass sin pasar por el constructor del reverso y nadie se enteraria — el pass saldria
  // mudo al tocar la "i" y ninguna prueba lo atraparia.
  reverso: CampoReverso[];
  // Ubicaciones del geopush (migración 0016). Arreglo vacío = el pass sale sin `locations`, que es
  // el estado de todo comercio que no cargó coordenadas.
  //
  // OBLIGATORIO igual que `reverso`, y por el mismo motivo: si fuera opcional, una ruta de emisión
  // nueva podría armar un pass sin ubicaciones y nadie se enteraría — el geopush simplemente no
  // funcionaría para esos clientes, en silencio y sin que ninguna prueba lo note.
  ubicaciones: UbicacionGeopush[];
}

export async function generarPassApple(datos: DatosPass): Promise<Buffer> {
  // Logo del comercio (esquina superior del pass), best-effort. Con logo propio se OMITE el
  // logoText: Apple los pone lado a lado y el nombre ya aparece grande en el cuerpo del pass
  // (referencia del usuario: los passes de la competencia muestran solo el logo).
  const logo = await descargarImagen(datos.logoUrl, 'el logo del comercio');

  const pass = await PKPass.from(
    {
      model: path.join(process.cwd(), 'passModels', 'loyalty.pass'),
      certificates: cargarCertificados(),
    },
    {
      // passTypeIdentifier/teamIdentifier vienen de env (misma fuente que usa el push APNs:
      // topic = APPLE_PASS_TYPE_IDENTIFIER, JWT = APPLE_TEAM_ID). Sobrescriben lo que trae
      // pass.json, así env es la ÚNICA fuente de verdad. Sin esto, un valor de env distinto al
      // de pass.json haría que el push nunca llegue (topic ≠ passTypeIdentifier del pass), y
      // fallaría en silencio justo en el paso que este skeleton valida.
      passTypeIdentifier: requireEnv('APPLE_PASS_TYPE_IDENTIFIER'),
      teamIdentifier: requireEnv('APPLE_TEAM_ID'),
      serialNumber: datos.serialNumber,
      organizationName: datos.nombreComercio,
      description: `Tarjeta de lealtad de ${datos.nombreComercio}`,
      ...(logo ? {} : { logoText: datos.nombreComercio }),
      backgroundColor: datos.colorFondo,
      foregroundColor: datos.colorTexto,
      labelColor: datos.colorLabel,
      webServiceURL: datos.webServiceURL,
      authenticationToken: datos.authenticationToken,
      // Radio del geopush, en metros. Va a nivel de PASE y no de cada ubicación: el schema
      // `Location` de PassKit solo tiene latitude/longitude/altitude/relevantText.
      //
      // Solo se manda si hay ubicaciones: un maxDistance suelto no hace nada y ensucia el pass.json
      // de todos los comercios que no usan geopush.
      ...(datos.ubicaciones.length > 0 ? { maxDistance: RADIO_GEOPUSH_METROS } : {}),
    },
  );

  pass.type = 'storeCard';

  // `locations` NO se puede pasar en el objeto de props de arriba: passkit-generator lo declara en
  // PassMethodsProps, o sea que exige su método dedicado. Se llama solo si hay ubicaciones —
  // setLocations() sin argumentos escribiría un arreglo vacío en el pass.json.
  //
  // El corte a 10 es la red de seguridad final: Apple ignora de la 11 en adelante EN SILENCIO, así
  // que preferimos que el corte sea nuestro y predecible. El tope real lo hace cumplir
  // guardarGeopushSucursal al activar una sucursal.
  if (datos.ubicaciones.length > 0) {
    pass.setLocations(
      ...datos.ubicaciones.slice(0, MAXIMO_UBICACIONES_APPLE).map((u) => ({
        latitude: u.latitud,
        longitude: u.longitud,
        // relevantText es lo que el cliente lee en la pantalla de bloqueo al pasar cerca. Sin él,
        // iOS muestra la tarjeta sin ninguna línea de contexto y se pierde todo el valor de
        // marketing. Se corta a 128 porque Apple no rechaza un texto más largo: lo trunca solo.
        ...(u.mensajeCercania
          ? { relevantText: u.mensajeCercania.slice(0, LARGO_MAXIMO_MENSAJE_CERCANIA) }
          : {}),
      })),
    );
  }

  // Franja visual (best-effort, nunca rompe la emisión): la imagen del comercio si subió una;
  // si no, para sellos una GRILLA de círculos llenos/vacíos compuesta con next/og, y para el
  // resto una banda sutil con los colores de la marca. (Evolución del contrato original de la
  // Fase 3, que era solo-texto porque entonces no había pipeline de imágenes.)
  const strips = await componerStrips({
    tipoTarjeta: datos.tipoTarjeta,
    puntos: datos.puntos,
    selloMeta: datos.selloMeta,
    colorFondo: datos.colorFondo,
    colorLabel: datos.colorLabel,
    stripUrl: datos.stripUrl,
    selloIconoUrl: datos.selloIconoUrl,
    heroUrl: datos.heroUrl,
    difuminadoFranja: datos.difuminadoFranja,
    encuadreFranja: datos.encuadreFranja,
  });
  if (strips) {
    pass.addBuffer('strip.png', strips.s1);
    pass.addBuffer('strip@2x.png', strips.s2);
    pass.addBuffer('strip@3x.png', strips.s3);
  }

  if (logo) {
    // Cada densidad a SU ancho (160/320/480 px). Antes iba el mismo buffer de 480 px en las tres,
    // "porque Wallet lo escala": eran 331 KB × 3 = 993 KB, el 56% de un pass de 1763 KB, para un
    // área de ~50 px de alto. Y el iPhone se baja el pass ENTERO cada vez que se acredita un punto,
    // así que ese peso se pagaba en CADA compra — el dueño reportó que la tarjeta tardaba en verse
    // actualizada (producción, 2026-07-26).
    const [logo1x, logo2x, logo3x] = await redimensionarLogo(logo.buf);
    pass.addBuffer('logo.png', logo1x);
    pass.addBuffer('logo@2x.png', logo2x);
    pass.addBuffer('logo@3x.png', logo3x);
  }

  // Qué va en el frente del pass lo decide frentePase, compartido con Google y con la vista previa
  // del editor de marca: así ninguno puede decir algo distinto del pass ni en una palabra. La franja
  // se le pasa YA RESUELTA contra lo que de verdad llegó al pase (ver `franjaDelPase`).
  const frente = frentePase({
    tipoTarjeta: datos.tipoTarjeta,
    puntos: datos.puntos,
    selloMeta: datos.selloMeta,
    franja: franjaDelPase(datos, strips !== null),
    vigenciaHasta: datos.vigenciaHasta,
    usadoEn: datos.usadoEn,
    nombrePase: datos.nombrePase,
    nombreCliente: datos.nombreCliente,
    apellidoCliente: datos.apellidoCliente,
    hoyIso: datos.hoyIso,
  });

  // El frente, como los diseños (spec 2026-09-17, "El frente, lugar por lugar"):
  //
  //   [logo]                 ESTADO      ← headerFields: arriba a la derecha, al lado del logo
  //   [ franja  nombre_pase           ]  ← primaryFields: SOLO sobre la banda lisa
  //   NOMBRE                 APELLIDO    ← secondaryFields: debajo de la franja
  //            [QR]
  //      Powered by Cardly               ← altText del código
  //
  // El ESTADO: el contador del tipo o, en cupón y membresía, la fecha corta ("VÁLIDO HASTA
  // 16/10/2026"). Nada en descuento. Número pelado → va como number CON numberStyle, para que iOS le
  // ponga los separadores de miles del teléfono. Valor ya formateado ("$25.00", "7 de 10",
  // "16/10/2026") → va como string y sin numberStyle: aplicárselo haría que iOS intente reformatear
  // lo que ya está formateado.
  if (frente.estado) {
    pass.headerFields.push({
      key: 'estado',
      label: frente.estado.etiqueta,
      ...(frente.estado.numero !== null
        ? { value: frente.estado.numero, numberStyle: 'PKNumberStyleDecimal' as const }
        : { value: frente.estado.valor }),
    });
  }

  // El NOMBRE del pase, sobre la franja. Sin etiqueta: es un nombre propio, no un dato con unidad.
  // frentePase ya lo devuelve null sobre una franja propia (la imagen trae su texto dibujado) y sobre
  // la grilla (taparía los círculos).
  if (frente.sobreFranja) {
    pass.primaryFields.push({ key: 'nombre_pase', value: frente.sobreFranja });
  }

  // El TITULAR de la tarjeta, como una de socio física: NOMBRE a la izquierda y APELLIDO a la
  // derecha, cada uno con su rótulo. El nombre del COMERCIO no va acá: ya está arriba (logo, o
  // logoText cuando no hay logo) y repetirlo dejaba la tarjeta sin decir de quién es.
  // Sin nombre no hay ninguno de los dos, y sin apellido va solo NOMBRE: una tarjeta sin el campo es
  // mejor que una que diga "null".
  if (frente.titular) {
    pass.secondaryFields.push({ key: 'nombre', label: 'NOMBRE', value: frente.titular.nombre });
    if (frente.titular.apellido) {
      pass.secondaryFields.push({
        key: 'apellido',
        label: 'APELLIDO',
        value: frente.titular.apellido,
        textAlignment: 'PKTextAlignmentRight',
      });
    }
  }

  // El REVERSO (lo que ve el cliente al tocar la "i"), ya armado por construirReverso. De a uno y
  // no `push(...datos.reverso)`: FieldsArray valida cada campo y DESCARTA el inválido con un
  // console.warn sin lanzar (FieldsArray.js, registerWithValidation), así que empujarlos uno por
  // uno no cambia el comportamiento pero deja el bucle donde se puede depurar cuál se perdió.
  for (const campo of datos.reverso) {
    pass.backFields.push(campo);
  }

  // UN solo código, QR, con "Powered by Cardly" debajo (altText). Con TODOS los campos explícitos:
  // en passkit-generator 3.5.7 la forma con objeto pasa por `Schemas.filterValid`, que DESCARTA en
  // silencio (console.warn, sin lanzar) un código mal formado — el pase saldría sin QR y sin error.
  // `format` y `message` son obligatorios en su esquema; `messageEncoding` tiene default, pero se
  // escribe para que el pass.json no dependa de un default de la librería.
  //
  // Antes era `setBarcodes(qrToken)`: el string genera CUATRO formatos (QR, PDF417, Aztec, Code128)
  // sin altText. Wallet muestra el primero que soporta —QR—, así que quedarse solo con QR no cambia
  // lo que escanea el cajero.
  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: datos.qrToken,
    messageEncoding: 'iso-8859-1',
    altText: PIE_CODIGO,
  });

  return pass.getAsBuffer();
}
