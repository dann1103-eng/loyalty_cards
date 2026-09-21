import { leerConfigWompi, type ConfigWompi } from './config';

// Cliente de la API de Wompi. Solo lo que la app usa:
//   - crearEnlacePago       POST /EnlacePago            (credenciales del NEGOCIO)
//   - consultarTransaccion  GET  /TransaccionCompra/{id} (credenciales del NEGOCIO)
//   - datosDelNegocio       GET  /Aplicativo            (credenciales del NEGOCIO)
//
// Los endpoints de enlaces que piden usuario y contraseña de la CUENTA Wompi (consultar por id, editar,
// activar, desactivar) NO están acá a propósito: esas credenciales no se guardan en la app. Los enlaces
// son de un solo uso y con vigencia corta, así que nunca hace falta desactivarlos.
//
// `fetch` y el reloj se inyectan para probar sin red. Ningún mensaje de error lleva el secreto.

export class ErrorWompi extends Error {
  constructor(
    mensaje: string,
    readonly estado: number | null,
  ) {
    super(mensaje);
    this.name = 'ErrorWompi';
  }
}

export interface DatosEnlace {
  // El id del cobro: vuelve en el webhook como EnlacePago.IdentificadorEnlaceComercio y en el redirect.
  identificador: string;
  monto: number;
  nombreProducto: string;
  descripcion: string;
  urlRedirect: string;
  urlRetorno: string;
  urlWebhook: string;
  ahora: Date;
  venceEn: Date;
  datosAdicionales: Record<string, string>;
}

export interface EnlaceCreado {
  idEnlace: number;
  urlEnlace: string;
  urlEnlaceLargo: string | null;
  esProductivo: boolean;
}

export interface TransaccionWompi {
  idTransaccion: string;
  esReal: boolean;
  esAprobada: boolean;
  monto: number;
  fecha: string | null;
  datosAdicionales: Record<string, string> | null;
}

export interface NegocioWompi {
  nombre: string | null;
  esProductivo: boolean;
}

export interface ClienteWompi {
  crearEnlacePago(datos: DatosEnlace): Promise<EnlaceCreado>;
  consultarTransaccion(idTransaccion: string): Promise<TransaccionWompi>;
  datosDelNegocio(): Promise<NegocioWompi>;
}

// El cuerpo de POST /EnlacePago según el Swagger de Wompi (CrearEnlaceDto). Solo tarjeta; un enlace es
// de un solo uso (`cantidadMaximaPagosExitosos: 1`), con el monto y la cantidad fijos, y vigencia acotada
// (`fechaInicio` es obligatoria cuando se manda `vigencia`).
export function cuerpoEnlace(datos: DatosEnlace): Record<string, unknown> {
  return {
    identificadorEnlaceComercio: datos.identificador,
    monto: datos.monto,
    nombreProducto: datos.nombreProducto,
    formaPago: {
      permitirTarjetaCreditoDebido: true,
      permitirPagoConPuntoAgricola: false,
      permitirPagoEnCuotasAgricola: false,
      permitirPagoEnBitcoin: false,
      permitePagoQuickPay: false,
      permitePagoNequi: false,
    },
    infoProducto: { descripcionProducto: datos.descripcion },
    configuracion: {
      urlRedirect: datos.urlRedirect,
      esMontoEditable: false,
      esCantidadEditable: false,
      cantidadPorDefecto: 1,
      duracionInterfazIntentoMinutos: 60,
      urlRetorno: datos.urlRetorno,
      urlWebhook: datos.urlWebhook,
      notificarTransaccionCliente: true,
    },
    vigencia: { fechaInicio: datos.ahora.toISOString(), fechaFin: datos.venceEn.toISOString() },
    limitesDeUso: { cantidadMaximaPagosExitosos: 1 },
    datosAdicionales: datos.datosAdicionales,
  };
}

const TIEMPO_MAXIMO_MS = 10_000;
// El token vale 3600 s; se renueva un minuto antes para no mandar uno que venza en el camino.
const MARGEN_TOKEN_S = 60;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function diccionarioDeTextos(valor: unknown): Record<string, string> | null {
  if (!esObjeto(valor)) return null;
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(valor)) if (typeof v === 'string') salida[k] = v;
  return salida;
}

async function detalle(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

export function crearClienteWompi(
  config: ConfigWompi,
  deps: { fetch?: typeof fetch; ahora?: () => number } = {},
): ClienteWompi {
  const hacerFetch = deps.fetch ?? fetch;
  const reloj = deps.ahora ?? Date.now;
  let token: { valor: string; venceEn: number } | null = null;

  async function obtenerToken(forzar: boolean): Promise<string> {
    if (!forzar && token && reloj() < token.venceEn) return token.valor;

    const cuerpo = new URLSearchParams({
      grant_type: 'client_credentials',
      audience: 'wompi_api',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
    const res = await hacerFetch(`${config.urlId}/connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    if (!res.ok) throw new ErrorWompi(`Wompi rechazó la autenticación (${res.status})`, res.status);

    const json: unknown = await res.json();
    const acceso = esObjeto(json) ? json.access_token : undefined;
    const dura = esObjeto(json) ? json.expires_in : undefined;
    if (typeof acceso !== 'string' || typeof dura !== 'number') {
      throw new ErrorWompi('Wompi devolvió una respuesta de autenticación inesperada', res.status);
    }
    token = { valor: acceso, venceEn: reloj() + Math.max(0, dura - MARGEN_TOKEN_S) * 1000 };
    return token.valor;
  }

  // Un 401 puede ser un token que Wompi ya invalidó aunque nosotros lo creamos vigente: se renueva y se
  // reintenta UNA vez. Cualquier otro estado se devuelve tal cual para que el llamador decida.
  async function llamar(ruta: string, init: { method: string; body?: string }): Promise<Response> {
    let respuesta: Response | null = null;
    for (const forzar of [false, true]) {
      const t = await obtenerToken(forzar);
      respuesta = await hacerFetch(`${config.urlApi}${ruta}`, {
        method: init.method,
        body: init.body,
        headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
      if (respuesta.status !== 401) return respuesta;
    }
    return respuesta as Response;
  }

  return {
    async crearEnlacePago(datos) {
      const res = await llamar('/EnlacePago', { method: 'POST', body: JSON.stringify(cuerpoEnlace(datos)) });
      if (!res.ok) throw new ErrorWompi(`Wompi no creó el enlace de pago (${res.status}): ${await detalle(res)}`, res.status);

      const json: unknown = await res.json();
      const idEnlace = esObjeto(json) ? json.idEnlace : undefined;
      const urlEnlace = esObjeto(json) ? json.urlEnlace : undefined;
      // La URL se usa para redirigir al dueño: solo se acepta https.
      if (typeof idEnlace !== 'number' || typeof urlEnlace !== 'string' || !urlEnlace.startsWith('https://')) {
        throw new ErrorWompi('Wompi devolvió un enlace de pago inesperado', res.status);
      }
      return {
        idEnlace,
        urlEnlace,
        urlEnlaceLargo: esObjeto(json) && typeof json.urlEnlaceLargo === 'string' ? json.urlEnlaceLargo : null,
        esProductivo: esObjeto(json) && json.estaProductivo === true,
      };
    },

    async consultarTransaccion(idTransaccion) {
      const res = await llamar(`/TransaccionCompra/${encodeURIComponent(idTransaccion)}`, { method: 'GET' });
      if (!res.ok) throw new ErrorWompi(`Wompi no devolvió la transacción (${res.status})`, res.status);

      const json: unknown = await res.json();
      if (!esObjeto(json)) throw new ErrorWompi('Wompi devolvió una transacción inesperada', res.status);
      const monto = typeof json.monto === 'number' ? json.monto : json.montoOriginal;
      if (typeof json.idTransaccion !== 'string' || typeof monto !== 'number') {
        throw new ErrorWompi('Wompi devolvió una transacción inesperada', res.status);
      }
      return {
        idTransaccion: json.idTransaccion,
        esReal: json.esReal === true,
        esAprobada: json.esAprobada === true,
        monto,
        fecha: typeof json.fechaTransaccion === 'string' ? json.fechaTransaccion : null,
        datosAdicionales: diccionarioDeTextos(json.datosAdicionales),
      };
    },

    async datosDelNegocio() {
      const res = await llamar('/Aplicativo', { method: 'GET' });
      if (!res.ok) throw new ErrorWompi(`Wompi no devolvió los datos del negocio (${res.status})`, res.status);
      const json: unknown = await res.json();
      if (!esObjeto(json)) throw new ErrorWompi('Wompi devolvió datos del negocio inesperados', res.status);
      return {
        nombre: typeof json.nombre === 'string' ? json.nombre : null,
        esProductivo: json.estaProductivo === true,
      };
    },
  };
}

// Una sola instancia por proceso: así el token vive entre llamadas mientras la función de Vercel siga caliente.
let instancia: ClienteWompi | null = null;
export function clienteWompi(): ClienteWompi {
  if (instancia === null) instancia = crearClienteWompi(leerConfigWompi());
  return instancia;
}
