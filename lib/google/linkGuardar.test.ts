import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createServiceClient } from '../supabase/server';
import { generarLinkGuardar } from './linkGuardar';
import { syncClaseComercio } from './syncClase';

// Par de llaves de PRUEBA generado en memoria — nunca toca las credenciales reales del proyecto.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const insertClaseMock = vi.fn();
const patchClaseMock = vi.fn();
const insertObjetoMock = vi.fn();
const patchObjetoMock = vi.fn();

vi.mock('./walletClient', () => ({
  issuerId: () => 'issuer-test',
  credencialesServicio: () => ({ client_email: 'cuenta-prueba@test.iam.gserviceaccount.com', private_key: privateKey }),
  walletClient: () => ({
    loyaltyclass: { insert: insertClaseMock, patch: patchClaseMock },
    loyaltyobject: { insert: insertObjetoMock, patch: patchObjetoMock },
  }),
}));

// La medición del logo, mockeada: los logos de prueba son URLs falsas y nada baja de la red. Por
// defecto "no se pudo medir".
const medidasLogoMock = vi.fn();
vi.mock('./logoRemoto', () => ({
  medidasLogo: (...args: unknown[]) => medidasLogoMock(...args),
}));

const supabase = createServiceClient();
let ids: { comercioId: string; programaId: string; clienteId: string; tarjetaId: string } | null = null;

beforeEach(() => {
  insertClaseMock.mockReset().mockResolvedValue({});
  patchClaseMock.mockReset().mockResolvedValue({});
  insertObjetoMock.mockReset().mockResolvedValue({});
  patchObjetoMock.mockReset().mockResolvedValue({});
  medidasLogoMock.mockReset().mockResolvedValue(null);
});

// NEXT_PUBLIC_BASE_URL lo fijan las pruebas de la portada compuesta (viaja dentro de la URL): se
// restaura para no filtrarlo al resto de la suite.
const BASE_ORIGINAL = process.env.NEXT_PUBLIC_BASE_URL;

async function crearTarjeta(opts: {
  googleClassId?: string | null;
  logoUrl?: string | null;
  puntos?: number;
  heroUrl?: string | null;
  nombreCliente?: string;
  apellidoCliente?: string | null;
}) {
  const sufijo = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data: comercio, error: eC } = await supabase
    .from('comercios')
    .insert({
      nombre: 'Comercio Link Test',
      slug: `test-google-link-${sufijo}`,
      google_class_id: opts.googleClassId === undefined ? 'issuer-test.comercio_x' : opts.googleClassId,
      logo_url: opts.logoUrl === undefined ? 'https://ejemplo.com/logo.png' : opts.logoUrl,
      hero_url: opts.heroUrl ?? null,
    })
    .select('id, nombre, tipo_tarjeta, sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias')
    .single();
  if (eC) throw eC;
  const { data: programa, error: eP } = await supabase
    .from('programas_tarjeta')
    .insert({
      comercio_id: comercio.id,
      nombre: comercio.nombre,
      slug: 'principal',
      tipo_tarjeta: comercio.tipo_tarjeta,
      es_principal: true,
      sello_meta: comercio.sello_meta,
      cashback_porcentaje: comercio.cashback_porcentaje,
      multipass_visitas: comercio.multipass_visitas,
      membresia_dias: comercio.membresia_dias,
      cupon_vigencia_dias: comercio.cupon_vigencia_dias,
    })
    .select('id')
    .single();
  if (eP) throw eP;
  const { data: cliente, error: eCl } = await supabase
    .from('clientes')
    .insert({
      nombre: opts.nombreCliente ?? 'Cliente Test',
      apellido: opts.apellidoCliente ?? null,
      telefono: `+503-link-${sufijo}`,
    })
    .select('id')
    .single();
  if (eCl) throw eCl;
  const { data: tarjeta, error: eT } = await supabase
    .from('tarjetas')
    .insert({ cliente_id: cliente.id, comercio_id: comercio.id, programa_id: programa.id, puntos_actuales: opts.puntos ?? 0 })
    .select('id')
    .single();
  if (eT) throw eT;
  ids = { comercioId: comercio.id, programaId: programa.id, clienteId: cliente.id, tarjetaId: tarjeta.id };
  return ids;
}

afterEach(async () => {
  if (BASE_ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
  else process.env.NEXT_PUBLIC_BASE_URL = BASE_ORIGINAL;
  if (!ids) return;
  await supabase.from('tarjetas').delete().eq('id', ids.tarjetaId);
  await supabase.from('clientes').delete().eq('id', ids.clienteId);
  await supabase.from('programas_tarjeta').delete().eq('id', ids.programaId);
  await supabase.from('comercios').delete().eq('id', ids.comercioId);
  ids = null;
});

describe('generarLinkGuardar', () => {
  it('produce un link https://pay.google.com/gp/v/save/<jwt> firmado y verificable', async () => {
    const t = await crearTarjeta({ puntos: 5 });
    const url = await generarLinkGuardar(supabase, t.tarjetaId);
    expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);

    const token = url!.replace('https://pay.google.com/gp/v/save/', '');
    const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'] }) as Record<string, unknown>;
    expect(claims.iss).toBe('cuenta-prueba@test.iam.gserviceaccount.com');
    expect(claims.aud).toBe('google');
    expect(claims.typ).toBe('savetowallet');
    const payload = claims.payload as { loyaltyClasses: Array<{ id: string }>; loyaltyObjects: Array<{ id: string; classId: string }> };
    expect(payload.loyaltyClasses[0].id).toBe('issuer-test.comercio_x');
    expect(payload.loyaltyObjects[0].id).toBe('issuer-test.tarjeta_' + t.tarjetaId);
    expect(payload.loyaltyObjects[0].classId).toBe('issuer-test.comercio_x');
  });

  // La clase viaja EMBEBIDA en el JWT y Google la upsertea por id al procesarlo. Si acá siguiera
  // mandando la foto cruda, cada cliente que toca "Agregar a Google Wallet" devolvería la portada
  // de TODO el negocio a la foto sin velo ni encuadre, deshaciendo lo que syncClaseComercio logró.
  describe('portada compuesta en la clase embebida', () => {
    async function claseDelJwt(tarjetaId: string) {
      const url = await generarLinkGuardar(supabase, tarjetaId);
      const claims = jwt.verify(url!.replace('https://pay.google.com/gp/v/save/', ''), publicKey, {
        algorithms: ['RS256'],
      }) as Record<string, unknown>;
      const payload = claims.payload as { loyaltyClasses: Array<{ heroImage?: { sourceUri: { uri: string } } }> };
      return payload.loyaltyClasses[0];
    }

    it('apunta a la portada compuesta del COMERCIO, sin ?programa=, cuando el programa no tiene clase propia', async () => {
      // MUTACIÓN 1: volver a `heroUrl: marca.heroUrl` → llega la URL de Storage y falla.
      // MUTACIÓN 2: usar `programa?.id ?? null` en vez de `claseDelPrograma` → la URL lleva
      // `?programa=` aunque la clase que viaja sea la del comercio, y también falla.
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      const t = await crearTarjeta({ heroUrl: 'https://ejemplo.com/hero.jpg' });
      const clase = await claseDelJwt(t.tarjetaId);
      expect(clase.heroImage!.sourceUri.uri).toMatch(
        new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${t.comercioId}/franja\\.png\\?v=[0-9a-f]{12}$`),
      );
    });

    it('con el MISMO ?v= que escribe syncClaseComercio: si difirieran, Google re-descargaría en cada JWT', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      const t = await crearTarjeta({ heroUrl: 'https://ejemplo.com/hero.jpg' });
      const clase = await claseDelJwt(t.tarjetaId);

      await syncClaseComercio(supabase, t.comercioId);
      const delSync = patchClaseMock.mock.calls.at(-1)![0].requestBody.heroImage.sourceUri.uri;

      expect(clase.heroImage!.sourceUri.uri).toBe(delSync);
    });
  });

  // Los logos de la clase embebida (spec 2026-09-23): Google upsertea la clase por id al procesar el
  // JWT, así que tienen que ser los de la clase que VIAJA — con la misma rama programa/comercio que la
  // portada — y con la MISMA URL que escribe el sync de esa clase.
  //
  // MUTACIONES corridas el 2026-09-23 (cada una restaurada y comparada con el índice de git):
  //   (a) La rama del comercio con la marca del PROGRAMA, `{ logoUrl: marca.logoUrl ?? logoComercio,
  //       colorFondo: marca.colorFondo }` → FALLA "clase del COMERCIO…" con `expected '…/logo.png?v=
  //       f81253de1bb7' to be '…/logo.png?v=bf273504f003'` (distinto del de syncClaseComercio).
  //   (b) Elegir la rama por `programa` en vez de `claseDelPrograma` → FALLA "clase del COMERCIO…": la URL
  //       lleva `?programa=` y no pasa el `toMatch`.
  //   (c) La rama del programa sin su id (`resolverLogosClase(tarjeta.comercio_id, null, …)`) → FALLA
  //       "clase del PROGRAMA (su sync anduvo)…" en el `toMatch` del `?programa=`.
  describe('logos en la clase embebida', () => {
    type ClaseJwt = {
      id: string;
      programLogo: { sourceUri: { uri: string } };
      wideProgramLogo?: { sourceUri: { uri: string } } | null;
    };
    async function claseDelJwt(tarjetaId: string): Promise<ClaseJwt> {
      const url = await generarLinkGuardar(supabase, tarjetaId);
      const claims = jwt.verify(url!.replace('https://pay.google.com/gp/v/save/', ''), publicKey, {
        algorithms: ['RS256'],
      }) as Record<string, unknown>;
      return (claims.payload as { loyaltyClasses: ClaseJwt[] }).loyaltyClasses[0];
    }

    // Para que viaje la clase del COMERCIO con un programa de logo propio, la sync de la clase del
    // programa tiene que FALLAR: el comercio del fixture ya tiene clase, así que el único insert es el
    // del programa. (Un programa sin logo propio no sirve: ahí los dos logos son el mismo.)
    //
    // Si el JWT llevara el logo del PROGRAMA en la clase del comercio, Google se lo pondría a TODAS las
    // tarjetas del negocio al upsertear, con un `?v=` distinto del de syncClaseComercio.
    it('clase del COMERCIO: el logo del comercio (sin ?programa=) aunque el programa tenga logo propio — el MISMO que escribe syncClaseComercio', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      medidasLogoMock.mockResolvedValue({ ancho: 300, alto: 300 });
      const t = await crearTarjeta({});
      await supabase
        .from('programas_tarjeta')
        .update({ branding_propio: true, logo_url: 'https://ejemplo.com/logo-PROGRAMA.png' })
        .eq('id', t.programaId);
      insertClaseMock.mockRejectedValueOnce(new Error('Google caído'));

      const clase = await claseDelJwt(t.tarjetaId);

      expect(clase.id).toBe('issuer-test.comercio_x');
      expect(clase.programLogo.sourceUri.uri).toMatch(
        new RegExp(`^https://www\\.cardly-sv\\.site/api/comercios/${t.comercioId}/logo\\.png\\?v=[0-9a-f]{12}$`),
      );
      // Medido y no ancho: el null viaja también dentro del JWT (borra un logo ancho viejo).
      expect('wideProgramLogo' in clase).toBe(true);
      expect(clase.wideProgramLogo).toBeNull();

      await syncClaseComercio(supabase, t.comercioId);
      const delSync = patchClaseMock.mock.calls.at(-1)![0].requestBody;
      expect(clase.programLogo.sourceUri.uri).toBe(delSync.programLogo.sourceUri.uri);
    });

    it('clase del PROGRAMA (su sync anduvo): los logos compuestos de ese programa, con ?programa=', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      medidasLogoMock.mockResolvedValue({ ancho: 480, alto: 160 });
      const t = await crearTarjeta({});
      await supabase
        .from('programas_tarjeta')
        .update({ branding_propio: true, logo_url: 'https://ejemplo.com/logo-PROGRAMA.png' })
        .eq('id', t.programaId);

      const clase = await claseDelJwt(t.tarjetaId);

      expect(clase.id).toBe(`issuer-test.programa_${t.programaId}`);
      // El MISMO cuerpo que acaba de insertar syncClasePrograma: si difirieran, el upsert del JWT lo pisaría.
      const delSync = insertClaseMock.mock.calls.at(-1)![0].requestBody;
      expect(clase.programLogo.sourceUri.uri).toMatch(
        new RegExp(`/api/comercios/${t.comercioId}/logo\\.png\\?programa=${t.programaId}&v=[0-9a-f]{12}$`),
      );
      expect(clase.programLogo.sourceUri.uri).toBe(delSync.programLogo.sourceUri.uri);
      expect(clase.wideProgramLogo!.sourceUri.uri).toBe(delSync.wideProgramLogo.sourceUri.uri);
    });
  });

  // El objeto viaja EMBEBIDO en el JWT y Google lo upsertea por id: un cuerpo sin los módulos del
  // frente PISARÍA al que syncObjetoTarjeta acaba de escribir bien (la falla del 2026-07-30 con el
  // tipo de tarjeta). Por eso este camino también lee clientes(nombre, apellido).
  describe('el objeto embebido (frente de los diseños, spec 2026-09-17)', () => {
    type ObjetoJwt = {
      textModulesData?: Array<{ id: string; header: string; body: string }>;
      barcode?: { type: string; value: string; alternateText?: string };
      heroImage?: { sourceUri: { uri: string } };
    };
    async function objetoDelJwt(tarjetaId: string): Promise<ObjetoJwt> {
      const url = await generarLinkGuardar(supabase, tarjetaId);
      const claims = jwt.verify(url!.replace('https://pay.google.com/gp/v/save/', ''), publicKey, {
        algorithms: ['RS256'],
      }) as Record<string, unknown>;
      return (claims.payload as { loyaltyObjects: ObjetoJwt[] }).loyaltyObjects[0];
    }

    // MUTACIÓN corrida: `apellidoCliente: null` en linkGuardar.ts → FALLA con `expected [ { id:
    // 'estado', …(2) }, …(1) ] to deeply equal [ { id: 'estado', …(2) }, …(2) ]` (falta APELLIDO).
    it('lleva NOMBRE y APELLIDO del cliente y el pie del QR', async () => {
      const t = await crearTarjeta({ puntos: 5, nombreCliente: 'María', apellidoCliente: 'Rivera' });
      const objeto = await objetoDelJwt(t.tarjetaId);
      expect(objeto.textModulesData).toEqual([
        { id: 'estado', header: 'PUNTOS', body: '5' },
        { id: 'nombre', header: 'NOMBRE', body: 'María' },
        { id: 'apellido', header: 'APELLIDO', body: 'Rivera' },
      ]);
      expect(objeto.barcode!.alternateText).toBe('Powered by Cardly');
    });

    // Los dos caminos que arman el objeto tienen que dar la MISMA URL de hero: si difirieran, cada
    // "Agregar a Google Wallet" haría que Google volviera a bajar la imagen. Con puntos (fuera de la
    // grilla) es donde más fácil divergen: un camino con los puntos en el hash y el otro sin ellos.
    // MUTACIÓN corrida: en linkGuardar.ts, `versionHero({ ...marca, puntos: tarjeta.puntos_actuales,
    // selloMeta })` en vez de versionHeroTarjeta → FALLA con `expected 'https://www.cardly-sv.site/
    // api/tarjet…' to be 'https://www.cardly-sv.site/api/tarjet…'`.
    it('el ?v= del hero es el MISMO que escribe syncObjetoTarjeta para la misma tarjeta', async () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://www.cardly-sv.site';
      const t = await crearTarjeta({ puntos: 5 });
      const objeto = await objetoDelJwt(t.tarjetaId);

      // generarLinkGuardar llama a syncObjetoTarjeta antes de armar el JWT: la tarjeta todavía no
      // tenía google_object_id, así que ese sync fue un insert.
      const delSync = insertObjetoMock.mock.calls.at(-1)![0].requestBody.heroImage.sourceUri.uri;
      expect(objeto.heroImage!.sourceUri.uri).toMatch(
        new RegExp(`^https://www\\.cardly-sv\\.site/api/tarjetas/${t.tarjetaId}/hero\\.png\\?v=[0-9a-f]{12}$`),
      );
      expect(objeto.heroImage!.sourceUri.uri).toBe(delSync);
    });
  });

  it('devuelve null si el comercio no tiene logo (Google lo exige, ni intenta autorreparar)', async () => {
    const t = await crearTarjeta({ logoUrl: null });
    expect(await generarLinkGuardar(supabase, t.tarjetaId)).toBeNull();
    expect(insertClaseMock).not.toHaveBeenCalled();
  });

  it('devuelve null para una tarjeta inexistente', async () => {
    expect(await generarLinkGuardar(supabase, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  describe('autorreparación (google_class_id/google_object_id faltantes)', () => {
    it('si falta google_class_id pero hay logo, sincroniza la clase sobre la marcha y sí devuelve un link', async () => {
      const t = await crearTarjeta({ googleClassId: null });
      const url = await generarLinkGuardar(supabase, t.tarjetaId);
      expect(url).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
      expect(insertClaseMock).toHaveBeenCalledOnce();

      const { data: comercio } = await supabase.from('comercios').select('google_class_id').eq('id', t.comercioId).single();
      expect(comercio?.google_class_id).toBe('issuer-test.comercio_' + t.comercioId);
    });

    it('si la autorreparación de la clase falla en Google, devuelve null (no revienta)', async () => {
      insertClaseMock.mockRejectedValueOnce(new Error('Google caído'));
      const t = await crearTarjeta({ googleClassId: null });
      expect(await generarLinkGuardar(supabase, t.tarjetaId)).toBeNull();

      const { data: comercio } = await supabase.from('comercios').select('google_class_id').eq('id', t.comercioId).single();
      expect(comercio?.google_class_id).toBeNull();
    });

    it('siempre sincroniza el objeto (aunque la clase ya existiera) para que tarjetas.google_object_id quede consistente', async () => {
      const t = await crearTarjeta({});
      await generarLinkGuardar(supabase, t.tarjetaId);
      expect(insertObjetoMock).toHaveBeenCalledOnce();

      const { data: tarjeta } = await supabase.from('tarjetas').select('google_object_id').eq('id', t.tarjetaId).single();
      expect(tarjeta?.google_object_id).toBe('issuer-test.tarjeta_' + t.tarjetaId);
    });
  });
});
