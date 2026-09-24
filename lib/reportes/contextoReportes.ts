import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { listarSucursales, type SucursalListada } from '../comercio/sucursales';
import { listarUsuariosDelComercio, type UsuarioDelComercio } from '../comercio/cajeros';
import { listarProgramas } from '../comercio/programas';
import { comercioAConsultar, type ComercioOwner, type ContextoReportes } from './filtrosReportes';
import type { ParametrosReportes } from './parametrosReportes';

// El ÚNICO cargador de lo que resolverFiltrosReportes necesita de la base (plan 2026-09-23, Tarea 3).
// Lo usan la página de Reportes Y la ruta del Excel, en este orden, para que las dos filtren igual:
//
//   const sesion     = await verifyComercioOwner();                      // FUERA de try/catch
//   const parametros = leerParametrosReportes(searchParams);
//   const cargado    = await cargarContextoReportes(supabase, sesion, parametros);
//   if (!cargado.ok) → la página: un aviso; la ruta: 500 en texto plano
//   const filtros    = resolverFiltrosReportes(sesion.comercios, parametros, cargado.contexto, new Date());
//
// Carga:
//   - la zona del comercio ACTIVO (el del switcher del header: con "Todo", los presets se resuelven
//     ahí; verifyComercioOwner no la trae);
//   - la zona y el tipo del programa principal de cada comercio del ALCANCE (el elegido, o todos con
//     "Todo");
//   - las sucursales y los usuarios del comercio que resuelve comercioAConsultar — la MISMA función que
//     usa el resolver, con la regla "un solo comercio = elegido": un dueño con un comercio tiene sus
//     listas aunque la URL no traiga ?comercio (el prechequeo viejo de la página miraba solo
//     ?comercio y no las cargaba nunca). `comercioDeLasListas` dice de qué comercio son.
//
// ══ LOS ERRORES SE PROPAGAN, NUNCA SE CONVIERTEN EN [] ══
// Devuelve `{ ok: false, error }` si falla CUALQUIERA de las lecturas; nunca un contexto a medias. El
// caso que lo exige: si el null de listarSucursales o listarUsuariosDelComercio se volviera `[]`, el
// resolver no encontraría el `?sucursal=`/`?cajero=` de la URL y lo descartaría EN SILENCIO — la
// pantalla mostraría los números sin filtrar como si fueran los de esa sucursal, y el Excel saldría
// igual. Lo mismo con la zona (un día cortado en otra zona) y los programas (un acumulado en otra
// unidad). `error` es un texto para el log, no para el dueño: la página muestra su propio aviso y la
// ruta su propio 500. (Las funciones de lib/comercio ya registraron el detalle con console.error.)
//
// Con "Todo" las listas vacías SÍ son la respuesta correcta: no hay un comercio contra el cual
// validar una sucursal o un cajero, y no se consulta nada.

export type ContextoReportesCargado = ContextoReportes<SucursalListada, UsuarioDelComercio>;

export type ResultadoContextoReportes =
  | { ok: true; contexto: ContextoReportesCargado }
  | { ok: false; error: string };

// Lo que el cargador usa del gate (verifyComercioOwner, cuyo retorno es asignable a esto).
export interface SesionReportes {
  // La cuenta que mira: su fila en usuarios_comercio es "Vos".
  authUserId: string;
  // El comercio ACTIVO (el del switcher), siempre uno de `comercios`.
  comercioId: string;
  // Los comercios donde la cuenta es owner: el alcance posible.
  comercios: ComercioOwner[];
}

export async function cargarContextoReportes(
  supabase: SupabaseClient<Database>,
  sesion: SesionReportes,
  parametros: Pick<ParametrosReportes, 'comercio'>,
): Promise<ResultadoContextoReportes> {
  const elegido = comercioAConsultar(sesion.comercios, parametros);
  const alcance = elegido ? [elegido] : sesion.comercios;
  const idsConZona = [...new Set([sesion.comercioId, ...alcance.map((c) => c.comercioId)])];

  // Todo en paralelo: una consulta de zonas, un listarProgramas por comercio del alcance, y las dos
  // listas del elegido (sin elegido, nada que consultar).
  const [zonas, programas, sucursales, usuarios] = await Promise.all([
    supabase.from('comercios').select('id, zona_horaria').in('id', idsConZona),
    Promise.all(alcance.map((c) => listarProgramas(supabase, c.comercioId))),
    elegido ? listarSucursales(supabase, elegido.comercioId) : Promise.resolve([]),
    elegido ? listarUsuariosDelComercio(supabase, elegido.comercioId, sesion.authUserId) : Promise.resolve([]),
  ]);

  if (zonas.error) {
    console.error('[reportes] falló la consulta de zonas horarias:', zonas.error);
    return { ok: false, error: 'No se pudieron leer las zonas horarias de los comercios.' };
  }
  if (programas.some((p) => p === null)) {
    return { ok: false, error: 'No se pudieron leer los programas de los comercios.' };
  }
  if (sucursales === null) return { ok: false, error: 'No se pudieron leer las sucursales del comercio.' };
  if (usuarios === null) return { ok: false, error: 'No se pudieron leer los usuarios del comercio.' };

  // Un comercio sin fila (se borró entre el gate y acá) queda con zona '': el resolver la trata como
  // cualquier zona inválida (cae a la del activo, y la del activo a ZONA_HORARIA_DEFAULT). No es un
  // error de lectura: la consulta respondió.
  const zonaDe = new Map((zonas.data ?? []).map((z) => [z.id, z.zona_horaria]));

  return {
    ok: true,
    contexto: {
      zonaComercioActivo: zonaDe.get(sesion.comercioId) ?? '',
      datosComercios: alcance.map((c, i) => ({
        comercioId: c.comercioId,
        zonaHoraria: zonaDe.get(c.comercioId) ?? '',
        // Sin programa principal activo, 'puntos': la misma degradación que la pantalla de Reportes
        // tenía hasta hoy (y tipoOPuntos en todo el proyecto). Un comercio sin principal es un estado
        // roto (0025), no un error de lectura.
        tipoPrincipal: programas[i]?.find((p) => p.esPrincipal)?.tipoTarjeta ?? 'puntos',
      })),
      comercioDeLasListas: elegido?.comercioId ?? null,
      sucursales,
      usuarios,
    },
  };
}
