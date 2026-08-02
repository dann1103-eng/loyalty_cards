import { esPlantillaCartel, type PlantillaCartel } from './tipos';
import { ctaSugerido } from './ctaSugerido';
import { sanearElementos, type ElementoCartel } from './elementos';

// Defaults del sistema cuando el comercio JAMÁS configuró su marca — mismos literales que ya usan
// app/comercio/(protegido)/branding/page.tsx (para precargar su formulario) y
// lib/comercios/crearComercioPropio.ts (para el alta), para que un comercio sin nada configurado vea
// el MISMO color en el cartel que vería si abriera su editor de marca.
const COLOR_FONDO_DEFECTO = 'rgb(19, 19, 21)';
const COLOR_TEXTO_DEFECTO = 'rgb(245, 245, 240)';
const COLOR_LABEL_DEFECTO = 'rgb(255, 157, 66)';

export interface ComercioParaCartel {
  nombre: string;
  color_fondo: string | null;
  color_texto: string | null;
  color_label: string | null;
  logo_url: string | null;
  hero_url: string | null;
}

export interface FilaDisenoCartel {
  plantilla: string;
  color_fondo: string | null;
  color_texto: string | null;
  color_label: string | null;
  logo_url: string | null;
  texto_cta: string;
  texto_teaser: string | null;
  // Crudo desde jsonb: acá adentro puede haber CUALQUIER cosa. Lo filtra sanearElementos.
  elementos: unknown;
}

export interface DatosCartelResueltos {
  nombreComercio: string;
  plantilla: PlantillaCartel;
  colorFondo: string;
  colorTexto: string;
  colorLabel: string;
  logoUrl: string | null;
  fotoUrl: string | null;
  textoCta: string;
  textoTeaser: string | null;
  elementos: ElementoCartel[];
}

// "En blanco" es una AUSENCIA, no una decisión: normaliza `''`/`'   '`/`undefined` a null para que
// la cadena de herencia de abajo los trate igual que un null.
//
// No está en el bloque de la Tarea 8 del plan — se agregó al implementarla, a propósito, y NO hay
// que borrarlo si alguien relee ese bloque viejo. El motivo: `??` y `||` solo difieren cuando el
// valor es falsy-pero-presente, y en esta función el único falsy posible es `''` (no hay booleanos
// ni números). Sin esta normalización, un `color_fondo` en blanco guardado a mano se dibujaría como
// `<rect fill="">` —cartel negro— y un `texto_cta` en blanco como un llamado a la acción invisible,
// sin que el dueño lo haya elegido nunca. Con ella, "en blanco = heredá" queda dicho UNA vez y de
// forma explícita, en vez de depender de qué operador se eligió en cada línea.
//
// Que "en blanco" signifique "heredá" no es una interpretación propia: es lo que ya hace la pantalla
// que escribe estos datos — `accionGuardarCartel` guarda `String(...).trim() || null`.
function valorConfigurado(valor: string | null | undefined): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

// El corazón del riesgo del spec: cada override en null hereda de `comercio`; la AUSENCIA total de
// `diseno` (null) equivale exactamente a que los overrides fueran null — por eso las dos primeras
// pruebas dan el mismo resultado. `fotoUrl` NO tiene override: siempre sale de `comercio.hero_url`
// (spec §3 — disenos_cartel no tiene columna de foto).
//
// Por qué `null` es "heredá" en TODOS los campos de override, y no un valor legítimo (que es lo que
// se contestó mal con `sello_meta` en lib/apple/datosPassDeTarjeta.ts, donde un cupón sin meta
// terminaba heredando la del comercio y el pase le dibujaba una grilla):
//   · spec §2.3 — "Los campos de color/logo del cartel nacen en `null` (= heredar de `comercios`) y
//     el comercio los puede pisar explícitamente";
//   · la UI — el único botón que escribe `logo_url = null` se llama "Quitar (volver al logo de
//     marca)", o sea que el null ES el pedido de heredar.
// No existe un "este cartel no lleva logo": si algún día hace falta, va en su propia columna
// booleana. Reinterpretar el null sería exactamente el bug de sello_meta, al revés.
// `tipoTarjeta` decide la frase que se PROPONE cuando el cartel todavía no tiene una guardada: una
// tarjeta de sellos nace diciendo "Acumulá sellos y ganá" y una de cashback "Acumulá saldo con tus
// compras", en vez de que las ocho digan el mismo "¡Escaneá y sumate!" que no cuenta qué gana el
// cliente. Es opcional para no romper a ningún llamador viejo: sin tipo, sale el genérico de antes.
export function combinarDatosCartel(
  comercio: ComercioParaCartel,
  diseno: FilaDisenoCartel | null,
  tipoTarjeta?: string | null,
): DatosCartelResueltos {
  return {
    // Sin normalizar a propósito: `comercios.nombre` es NOT NULL y validado al guardar, y no hay
    // nada de dónde heredarlo. Un nombre raro no rompe el cartel — logoSvg() ya cae a '?'.
    nombreComercio: comercio.nombre,
    // El dato guardado no se cree sin validar: la BD tiene un CHECK, pero una fila vieja o corrupta
    // no debe propagar una plantilla inexistente hasta el dispatcher de plantillas.ts (que lanza).
    plantilla: esPlantillaCartel(diseno?.plantilla) ? diseno.plantilla : 'centrado',
    colorFondo:
      valorConfigurado(diseno?.color_fondo) ??
      valorConfigurado(comercio.color_fondo) ??
      COLOR_FONDO_DEFECTO,
    colorTexto:
      valorConfigurado(diseno?.color_texto) ??
      valorConfigurado(comercio.color_texto) ??
      COLOR_TEXTO_DEFECTO,
    colorLabel:
      valorConfigurado(diseno?.color_label) ??
      valorConfigurado(comercio.color_label) ??
      COLOR_LABEL_DEFECTO,
    logoUrl: valorConfigurado(diseno?.logo_url) ?? valorConfigurado(comercio.logo_url),
    fotoUrl: valorConfigurado(comercio.hero_url),
    // OJO con el orden: la sugerencia por tipo es solo el DEFAULT. Un cartel ya guardado gana
    // siempre — incluso si lo que guardó es el genérico, porque eso fue una decisión del dueño.
    textoCta: valorConfigurado(diseno?.texto_cta) ?? ctaSugerido(tipoTarjeta),
    // `comercios` no tiene teaser: acá null es "sin segunda línea", no "heredá" — no hay de dónde.
    textoTeaser: valorConfigurado(diseno?.texto_teaser),
    // Sin diseño guardado no hay extras: no hay nada de dónde heredarlos (`comercios` no tiene
    // elementos), y una lista vacía es exactamente el cartel de siempre.
    elementos: sanearElementos(diseno?.elementos),
  };
}
