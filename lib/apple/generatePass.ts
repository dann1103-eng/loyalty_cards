import { PKPass } from 'passkit-generator';
import path from 'node:path';
import { requireEnv } from '@/lib/env';
import { componerStrips, descargarImagen } from './stripPass';
import { redimensionarLogo } from './imagenesPass';
import type { CampoReverso } from './construirReverso';
import { contadorPase } from '@/lib/tarjetas/contadorPase';
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

export interface DatosPass {
  serialNumber: string;
  qrToken: string;
  puntos: number;
  // Titular de la tarjeta (clientes.nombre). null si no se pudo resolver: el pass sale sin el campo.
  nombreCliente: string | null;
  nombreComercio: string;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  webServiceURL: string;
  authenticationToken: string;
  tipoTarjeta: string;
  selloMeta: number | null;
  stripUrl: string | null;
  selloIconoUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  difuminadoFranja: string;
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

  const esSellos = datos.tipoTarjeta === 'sellos' && datos.selloMeta != null && datos.selloMeta > 0;
  if (esSellos && strips && !datos.stripUrl) {
    // La grilla se VE en la franja; texto encima taparía los círculos (los primaryFields de un
    // storeCard se dibujan sobre el strip). El contador baja a secondaryFields, debajo.
    pass.secondaryFields.push({
      key: 'puntos',
      label: 'SELLOS',
      value: `${datos.puntos} de ${datos.selloMeta}`,
    });
  } else if (esSellos) {
    // Sin grilla (composición falló, o el comercio usa SU franja): el texto vuelve al campo
    // primario — mismo fallback seguro de siempre.
    pass.primaryFields.push({
      key: 'puntos',
      label: 'SELLOS',
      value: `${datos.puntos} de ${datos.selloMeta} sellos`,
    });
  } else {
    // contadorPase decide etiqueta y formato SEGÚN EL TIPO. Antes esta rama dibujaba todo como
    // "PUNTOS <entero>", y como gift card y cashback guardan CENTAVOS en la misma columna, un saldo
    // de $25.00 se veía "PUNTOS 2500". Devuelve null en los tipos sin contador (cupón, membresía,
    // descuento): ahí el pase no lleva número, en vez de un "PUNTOS 0" que no dice nada.
    const contador = contadorPase(datos.tipoTarjeta, datos.puntos, datos.selloMeta);
    if (contador) {
      pass.primaryFields.push({
        key: 'puntos',
        label: contador.etiqueta,
        // Número pelado → va como number CON numberStyle, para que iOS le ponga los separadores de
        // miles del teléfono. Valor ya formateado ("$25.00") → va como string y sin numberStyle:
        // aplicárselo haría que iOS intente reformatear lo que ya está formateado.
        ...(contador.numero !== null
          ? { value: contador.numero, numberStyle: 'PKNumberStyleDecimal' as const }
          : { value: contador.valor }),
      });
    }
  }

  // El TITULAR de la tarjeta, alineado a la derecha de la misma fila que el contador. Es el nombre
  // que el cliente escribió al registrarse — como una tarjeta de socio física, que lleva el nombre
  // de quien la usa. El nombre del COMERCIO no va acá: ya está arriba (logo, o logoText cuando no
  // hay logo) y repetirlo dejaba la tarjeta sin decir de quién es.
  // Se omite si falta: una tarjeta sin nombre es mejor que una que diga "null".
  if (datos.nombreCliente) {
    pass.secondaryFields.push({
      key: 'titular',
      value: datos.nombreCliente,
      textAlignment: 'PKTextAlignmentRight',
    });
  }

  // El REVERSO (lo que ve el cliente al tocar la "i"), ya armado por construirReverso. De a uno y
  // no `push(...datos.reverso)`: FieldsArray valida cada campo y DESCARTA el inválido con un
  // console.warn sin lanzar (FieldsArray.js, registerWithValidation), así que empujarlos uno por
  // uno no cambia el comportamiento pero deja el bucle donde se puede depurar cuál se perdió.
  for (const campo of datos.reverso) {
    pass.backFields.push(campo);
  }

  pass.setBarcodes(datos.qrToken);

  return pass.getAsBuffer();
}
