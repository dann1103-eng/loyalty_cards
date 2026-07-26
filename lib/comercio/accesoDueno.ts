import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { EMAIL_RE } from './cajeros';

// Alta del ACCESO de un dueño sin que FM conozca su contraseña: genera un link de un solo uso que
// FM comparte por WhatsApp y que el cliente canjea para definir su propia clave. Reemplaza a
// `npm run seed-comercio`, que obligaba a elegir —y por lo tanto a conocer— la contraseña del
// cliente, y además solo se podía correr desde la terminal.
//
// SEGURIDAD: el link y el `hashed_token` son CREDENCIALES temporales. No se loguean NUNCA, no se
// guardan en la BD y no se devuelven en ningún error: viven solo en el `link` de un resultado ok.
// Ante un fallo de Auth se registra SOLO `error.message` — jamás el objeto de respuesta, que trae
// `properties.hashed_token` adentro.

export type ResultadoAccesoDueno = { ok: true; link: string } | { ok: false; error: string };

export async function generarAccesoDueno(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  email: string,
  // Sin barra final: la normaliza quien lee NEXT_PUBLIC_BASE_URL (convención de la casa, ver
  // lib/apple/datosPassDeTarjeta.ts). Acá se concatena tal cual.
  baseUrl: string,
): Promise<ResultadoAccesoDueno> {
  // Mismo EMAIL_RE que cajeros.ts a propósito (importado, no copiado): dos reglas de correo
  // divergentes en el mismo repo aceptarían dueños que el alta de cajeros rechaza, y al revés.
  const correo = email.trim().toLowerCase();
  if (!EMAIL_RE.test(correo)) return { ok: false, error: 'El correo no es válido.' };

  // El comercio se verifica ANTES de tocar Auth (mismo criterio que crearCajero): con un id que no
  // existe, invertir el orden dejaría una cuenta de Auth huérfana que nadie va a reclamar y que ya
  // no se puede volver a invitar. Falla CERRADO ante un error de infra.
  const { data: comercio, error: eComercio } = await supabase
    .from('comercios')
    .select('id')
    .eq('id', comercioId)
    .maybeSingle();
  if (eComercio) {
    console.error('[comercio] no se pudo leer el comercio al generar el acceso:', eComercio.message);
    return { ok: false, error: 'No se pudo generar el acceso.' };
  }
  if (!comercio) return { ok: false, error: 'Ese comercio ya no existe.' };

  // Rol de la membresía que ese correo YA pueda tener en ESTE comercio. Va acá, ANTES de tocar
  // Auth, para que el rechazo de abajo no deje una cuenta recién creada colgando. El unique
  // (comercio_id, email) de la 0008 garantiza que sea a lo sumo una fila → maybeSingle. Falla
  // CERRADO ante un error de infra.
  const { data: membresiaPrevia, error: eMembresiaPrevia } = await supabase
    .from('usuarios_comercio')
    .select('rol')
    .eq('comercio_id', comercioId)
    .eq('email', correo)
    .maybeSingle();
  if (eMembresiaPrevia) {
    console.error('[comercio] no se pudo leer la membresía previa al generar el acceso:', eMembresiaPrevia.message);
    return { ok: false, error: 'No se pudo generar el acceso.' };
  }

  // Ya es owner → se sigue de largo: ese es el caso de REGENERAR el link (vencido u olvidado), la
  // razón de ser de la idempotencia de más abajo. Cualquier otro rol corta ACÁ. Sin este candado,
  // el insert del final chocaría contra el unique, el 23505 se leería como éxito y FM se llevaría
  // un link válido para alguien que entra sin poder administrar nada: un "salió bien" que miente y
  // que Daniel no tendría cómo diagnosticar.
  //
  // El mensaje NO sugiere dar de baja al cajero: la baja es SOFT (desactivarCajero deja la fila con
  // activo=false para preservar el ledger), así que la fila sigue ocupando el par (comercio, correo)
  // y el alta del dueño volvería a chocar. Por eso el único camino real es otro correo. Se compara
  // `!== 'owner'` y no `=== 'cajero'` para que un rol futuro también corte acá en vez de colarse
  // (hoy el CHECK de la 0001 solo admite esos dos).
  if (membresiaPrevia && membresiaPrevia.rol !== 'owner') {
    return {
      ok: false,
      error:
        'Ese correo ya está registrado como cajero de este comercio. Usá otro correo para el dueño: ' +
        'dar de baja al cajero no libera el correo, su fila se conserva para el historial.',
    };
  }

  // `invite` CREA la cuenta de Auth y devuelve el token sin mandar correo (este proyecto no tiene
  // servicio de email; por eso el link se comparte a mano).
  const invitacion = await supabase.auth.admin.generateLink({ type: 'invite', email: correo });

  // Fallback verificado contra el proyecto real: si el correo ya pertenece a una cuenta CONFIRMADA
  // —el dueño que ya administra otro comercio, o el que ya definió su clave— GoTrue responde
  // AuthApiError status 422, code 'email_exists', message "A user with this email address has
  // already been registered", y `data.properties` viene en null. A esa cuenta no se la puede
  // invitar de nuevo, pero sí puede recibir un link de `recovery`: mismo destino y mismo efecto
  // para el cliente (define su clave y entra). Se discrimina por `code`, no por el texto del
  // mensaje, que Supabase puede reescribir sin avisar. Ojo: con una cuenta SIN confirmar (invitado
  // que nunca abrió su link) `invite` NO falla y devuelve un token nuevo — justo lo que se quiere
  // al regenerar un link vencido.
  const resultado =
    invitacion.error?.code === 'email_exists'
      ? await supabase.auth.admin.generateLink({ type: 'recovery', email: correo })
      : invitacion;

  if (resultado.error) {
    // SOLO el message: el objeto de respuesta lleva el token adentro.
    console.error('[comercio] falló generateLink al generar el acceso del dueño:', resultado.error.message);
    return { ok: false, error: 'No se pudo generar el acceso.' };
  }
  const { properties, user } = resultado.data;

  // Membresía owner atada a esa cuenta de Auth: sin ella el dueño entra con sesión pero sin
  // permisos (membresiasDeUsuario matchea por auth_user_id) y el gate lo expulsa.
  //
  // IDEMPOTENTE A PROPÓSITO: el unique (comercio_id, email) de la migración 0008 hace que la
  // segunda llamada choque con 23505, y eso es ÉXITO. FM regenera links sobre dueños que YA están
  // dados de alta —link vencido, clave olvidada—, que son justo los casos en los que más se
  // necesita; tratar el duplicado como error rompería ese camino entero. El candado de rol de más
  // arriba ya descartó al cajero, así que un 23505 acá solo puede ser el owner que ya estaba (o dos
  // altas simultáneas del MISMO dueño, que terminan en el mismo estado). No se hace upsert:
  // pisaría `rol`/`auth_user_id` de una fila existente, y si ese correo fuera un CAJERO de este
  // comercio lo ascendería a owner en silencio.
  const { error: eMembresia } = await supabase.from('usuarios_comercio').insert({
    comercio_id: comercioId,
    email: correo,
    rol: 'owner',
    auth_user_id: user.id,
  });
  if (eMembresia && eMembresia.code !== '23505') {
    console.error('[comercio] falló el insert de la membresía del dueño:', eMembresia.message);
    return { ok: false, error: 'No se pudo registrar al dueño.' };
  }

  // El link apunta a NUESTRO dominio, no al `action_link` que devuelve Supabase: ese va al dominio
  // del proyecto de Supabase y exigiría configurar Redirect URLs en su dashboard. Con
  // `hashed_token` + `verification_type` alcanza para que la ruta de activación llame a verifyOtp.
  // El `tipo` viaja en la URL porque el canje necesita saber si es 'invite' o 'recovery'.
  return {
    ok: true,
    link: `${baseUrl}/comercio/activar?token_hash=${properties.hashed_token}&tipo=${properties.verification_type}`,
  };
}
