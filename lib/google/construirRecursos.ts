import type { walletobjects_v1 } from 'googleapis/build/src/apis/walletobjects/v1';
import { rgbAHex } from './colorHex';
import { frentePase, type CampoFrente } from '../tarjetas/frentePase';
import { tipoOPuntos } from '../tarjetas/tipos';

// Insumos mínimos para armar una LoyaltyClass: solo lo que la clase realmente usa (no el row
// completo de `comercios`), para que estas funciones sean puras y fáciles de testear sin DB.
export interface ComercioParaClase {
  nombre: string;
  colorFondo: string | null;
  logoUrl: string; // requerido: programLogo es obligatorio en la API (ver syncClase.ts, que
  // filtra ANTES de llamar aquí a los comercios sin logo — Google no tiene el fallback de
  // logoText que sí usa Apple).
  heroUrl: string | null;
  // Geopush (migración 0016). Google dispara la notificación de cercanía a partir de estas
  // ubicaciones, igual que Apple con `locations` — pero con dos diferencias que importan:
  //   1. `MerchantLocation` NO lleva texto. El mensaje de la notificación lo pone Google y no se
  //      puede editar, así que `mensajeCercania` solo se usa del lado de Apple.
  //   2. Google RECHAZA la clase entera si mandás más de 10. Apple, en cambio, ignora de la 11 en
  //      adelante en silencio. Acá el corte no es prolijidad: sin él, un comercio con 11 sucursales
  //      se queda sin Google Wallet por completo.
  ubicaciones: { latitud: number; longitud: number }[];
}

// Tope duro de la API de Google, igual que el de Apple. Se declara acá y no se importa de
// lib/comercio/geopush para no atar el módulo de construcción de recursos de Google a la capa de
// datos del comercio: si algún día Google cambia su límite, se cambia solo este número.
const MAXIMO_UBICACIONES_GOOGLE = 10;

// reviewStatus 'UNDER_REVIEW' (no 'draft'): un draft no puede usarse para crear objetos.
// Cuentas Admin/Developer del propio Emisor SÍ pueden agregar passes de clases underReview
// sin esperar el acceso de publicación (spec §3 del diseño, verificado contra la guía oficial
// de onboarding). [Fuente: google-wallet/rest-samples/nodejs/demo-loyalty.js]
export function construirClase(classId: string, comercio: ComercioParaClase): walletobjects_v1.Schema$LoyaltyClass {
  const hex = rgbAHex(comercio.colorFondo);
  return {
    id: classId,
    issuerName: comercio.nombre,
    programName: comercio.nombre,
    reviewStatus: 'UNDER_REVIEW',
    programLogo: { sourceUri: { uri: comercio.logoUrl } },
    ...(comercio.heroUrl ? { heroImage: { sourceUri: { uri: comercio.heroUrl } } } : {}),
    ...(hex ? { hexBackgroundColor: hex } : {}),
    // `merchantLocations` y NO `locations`: este último es el LatLongPoint que la propia API marca
    // como deprecado ("This field replaces the deprecated LatLongPoints"). Solo se manda si hay
    // ubicaciones — un arreglo vacío es ruido en la clase de todos los comercios sin geopush.
    ...(comercio.ubicaciones.length > 0
      ? {
          merchantLocations: comercio.ubicaciones
            .slice(0, MAXIMO_UBICACIONES_GOOGLE)
            .map((u) => ({ latitude: u.latitud, longitude: u.longitud })),
        }
      : {}),
  };
}

export interface TarjetaParaObjeto {
  qrToken: string;
  puntosActuales: number;
  tipoTarjeta: string;
  selloMeta: number | null;
  // URL pública de la grilla de sellos COMPUESTA PARA ESTA TARJETA (ver lib/google/heroUrl.ts).
  // Ya no es solo texto: heroImage existe también a nivel de LoyaltyObject (no solo de clase,
  // corrección al diseño original — ver memoria del proyecto), así que cada cliente puede ver su
  // propio progreso visual, igual que en Apple. Solo se usa para sellos (ver construirObjeto);
  // en puntos queda sin heroImage propio y se ve el de la clase (foto de fondo del comercio).
  heroImageUrl?: string | null;
  // Las MISMAS ubicaciones que van en la clase. Google pide explícitamente ponerlas en los dos
  // lados ("add locations to your classes and objects"), y `LoyaltyObject.merchantLocations` está
  // documentado como disparador por su cuenta. Hasta el 2026-07-30 solo estaban en la clase y
  // ningún Android recibía el aviso de cercanía. Requerido a propósito (igual que en
  // ComercioParaClase): que el compilador obligue a cada llamador a decidir, en vez de que un
  // callejero nuevo se olvide en silencio — que es exactamente el bug que esto vino a cerrar.
  ubicaciones: { latitud: number; longitud: number }[];
  // `tarjetas.vigencia_hasta` (AAAA-MM-DD) y `tarjetas.usado_en`: el estado de un cupón o una
  // membresía es una FECHA, no un número. Obligatorios a propósito, igual que `ubicaciones`: que el
  // compilador obligue a cada llamador a decidir, en vez de que una ruta nueva se olvide en
  // silencio y le mande a Android una membresía sin fecha.
  vigenciaHasta: string | null;
  usadoEn: string | null;
  // `programas_tarjeta.nombre_pase`. null = el pase sale sin textModulesData, como hasta ahora.
  nombrePase: string | null;
  // El "hoy" del COMERCIO (hoyEnZona(comercio.zona_horaria)): es lo que decide si la membresía dice
  // "Activa hasta" o "Vencida el". Nunca un new Date() adentro — ver frentePase.
  hoyIso: string;
}

// El texto ("7 de 10 sellos") queda SIEMPRE como loyaltyPoints, incluso con grilla visual: es lo
// que se lee en la vista de lista de Wallet (donde no cabe la imagen) y el respaldo si la
// composición de la grilla falla.
//
// Por eso recibe `frentePase(...).listado` y NO `.primario`: con grilla, `primario` es null (en
// Apple el texto taparía los círculos) y tomarlo acá dejaría a cada Android con una tarjeta de
// sellos SIN contador, sin un solo error del lado de Google. `listado` es la línea única que
// describe la tarjeta sin importar dónde se dibuje, y ya trae la palabra "sellos": agregarla acá
// otra vez daría "3 de 8 sellos sellos".
function loyaltyPointsDe(listado: CampoFrente | null): walletobjects_v1.Schema$LoyaltyPoints | null {
  // Misma fuente de verdad que el lado de Apple (lib/tarjetas/frentePase.ts), para que las dos
  // plataformas no puedan divergir en lo que el cliente lee de un vistazo. Antes esta función
  // mandaba `balance.int` para todo lo que no fuera sellos, y como gift card y cashback guardan
  // CENTAVOS, un saldo de $25.00 llegaba a Google Wallet como "Puntos 2500".
  if (!listado) return null;
  // La etiqueta va capitalizada —"Saldo", no "SALDO"— porque en Google es una etiqueta de campo, no
  // el encabezado en mayúsculas que usa Apple.
  const etiqueta = listado.etiqueta.charAt(0) + listado.etiqueta.slice(1).toLowerCase();
  // `int` cuando el contador es un número pelado, para que Google le ponga los separadores de miles
  // del teléfono; `string` cuando el valor ya viene formateado ("$25.00", "3 de 8 sellos", "Activa
  // hasta el 12 de octubre de 2026"), donde un int sería imposible o perdería la unidad.
  if (listado.numero !== null) return { label: etiqueta, balance: { int: listado.numero } };
  return { label: etiqueta, balance: { string: listado.valor } };
}

// Hasta cuándo vale el pase. Google mueve solo el objeto a "Pases caducados" cuando el intervalo
// queda en el pasado, y es la ÚNICA de las dos billeteras que lo hace: el `expirationDate` de Apple
// está fuera de alcance (ver generatePass.ts), así que el pase de iPhone de una membresía vencida
// sigue diciendo "Activa hasta el …" hasta el próximo escaneo, que es cuando llega el push.
//
// La fecha va SIN offset a propósito. La API documenta que un date/time sin offset es hora LOCAL
// del teléfono, que es exactamente lo que significa "vence el 12"; con `Z` el pase se apagaría a
// las 6 de la tarde del 12 en El Salvador.
function validTimeIntervalDe(t: TarjetaParaObjeto): walletobjects_v1.Schema$TimeInterval | null {
  // Solo los tipos cuyo estado ES una fecha. Una fecha suelta en una tarjeta de puntos sería basura
  // de una migración vieja, y apagarle el pase al cliente por eso sería peor que ignorarla.
  if (!tipoOPuntos(t.tipoTarjeta).usaVigencia || !t.vigenciaHasta) return null;
  return { end: { date: `${t.vigenciaHasta.slice(0, 10)}T23:59:59` } };
}

function esSellosConMeta(t: TarjetaParaObjeto): boolean {
  return t.tipoTarjeta === 'sellos' && t.selloMeta != null && t.selloMeta > 0;
}

export function construirObjeto(
  objectId: string,
  classId: string,
  tarjeta: TarjetaParaObjeto,
): walletobjects_v1.Schema$LoyaltyObject {
  // El MISMO módulo que arma el frente del pass de Apple y la vista previa del editor de marca.
  // `hayGrilla` acá es "el objeto lleva su grilla compuesta en heroImage" (la condición de abajo),
  // que es el equivalente exacto de la franja compuesta de Apple.
  const frente = frentePase({
    tipoTarjeta: tarjeta.tipoTarjeta,
    puntos: tarjeta.puntosActuales,
    selloMeta: tarjeta.selloMeta,
    hayGrilla: esSellosConMeta(tarjeta) && Boolean(tarjeta.heroImageUrl),
    vigenciaHasta: tarjeta.vigenciaHasta,
    usadoEn: tarjeta.usadoEn,
    nombrePase: tarjeta.nombrePase,
    hoyIso: tarjeta.hoyIso,
  });
  const puntos = loyaltyPointsDe(frente.listado);
  const vigencia = validTimeIntervalDe(tarjeta);
  return {
    id: objectId,
    classId,
    state: 'ACTIVE',
    barcode: { type: 'QR_CODE', value: tarjeta.qrToken },
    // Se OMITE la clave si el tipo no tiene nada que decir (descuento, cuyo estado es un porcentaje
    // que este objeto no recibe), en vez de mandar null: Google rechaza un loyaltyPoints nulo, y un
    // "Puntos 0" no le diría nada al cliente. Mismo criterio que heroImage y merchantLocations.
    ...(puntos ? { loyaltyPoints: puntos } : {}),
    // El NOMBRE del pase, lo que el cliente ve para saber cuál de sus tarjetas es esta. Va en
    // textModulesData porque es el equivalente de Google al headerField de Apple; `header` es el
    // rótulo del módulo y `body`, el nombre. El `id` permite referenciarlo desde un template
    // override si algún día hace falta.
    ...(frente.encabezado
      ? { textModulesData: [{ id: 'nombre_pase', header: 'Tarjeta', body: frente.encabezado }] }
      : {}),
    ...(vigencia ? { validTimeInterval: vigencia } : {}),
    ...(esSellosConMeta(tarjeta) && tarjeta.heroImageUrl
      ? { heroImage: { sourceUri: { uri: tarjeta.heroImageUrl } } }
      : {}),
    // Mismo corte de 10 y mismo criterio que la clase: un arreglo vacío es ruido en el objeto de
    // cada cliente de todos los comercios sin geopush.
    ...(tarjeta.ubicaciones.length > 0
      ? {
          merchantLocations: tarjeta.ubicaciones
            .slice(0, MAXIMO_UBICACIONES_GOOGLE)
            .map((u) => ({ latitude: u.latitud, longitude: u.longitud })),
        }
      : {}),
  };
}
