import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { validarColorRgb } from './validarColorRgb';
import { verificarLimiteCuenta } from './cuentas';
import { crearSucursalPrincipal } from '../comercio/sucursales';
import { crearProgramaPrincipal } from '../comercio/programas';

// Fuente única de verdad del catálogo de tipos de tarjeta: la BD tiene
// check (tipo_tarjeta in (...8 valores...)) en la migración 0005. El <select> de FM se construye
// desde esta MISMA constante.
//
// `disponible` marcaba los tipos cuyo motor todavía no existía ("(Próximamente)" y deshabilitado en
// el select). Desde las migraciones 0018-0023 los OCHO tienen su mecánica construida y probada, así
// que están todos en true. La bandera se conserva —no se borra— porque es el mecanismo honesto para
// cuando entre un tipo nuevo: mejor mostrarlo deshabilitado que fingir que funciona.
//
// OJO: este catálogo tiene las etiquetas y descripciones que ve FM. La MECÁNICA de cada tipo (si su
// contador es dinero, si exige monto, qué hace el cajero al escanear) vive en lib/tarjetas/tipos.ts.
// Son dos vistas de los mismos ocho valores y hay una prueba que falla si divergen.
export const TIPOS_TARJETA = [
  { valor: 'puntos', etiqueta: 'Puntos', descripcion: 'Suma puntos por visita o por monto.', disponible: true },
  { valor: 'sellos', etiqueta: 'Sellos', descripcion: 'Junta sellos hacia una meta (ej. 9 y la 10 gratis).', disponible: true },
  { valor: 'cashback', etiqueta: 'Cashback', descripcion: 'Un porcentaje de cada compra vuelve como saldo.', disponible: true },
  { valor: 'membresia', etiqueta: 'Membresía', descripcion: 'El cliente paga por pertenecer y renueva cada cierto tiempo.', disponible: true },
  { valor: 'descuento', etiqueta: 'Descuento por nivel', descripcion: 'Entre más gasta, mayor su descuento permanente.', disponible: true },
  { valor: 'cupon', etiqueta: 'Cupón', descripcion: 'Una oferta de una sola vez, con fecha de vencimiento.', disponible: true },
  { valor: 'prepago', etiqueta: 'Prepago', descripcion: 'Paquete de visitas que el cliente compra y va usando.', disponible: true },
  { valor: 'gift_card', etiqueta: 'Gift Card', descripcion: 'Saldo cargado por adelantado que el cliente va gastando.', disponible: true },
] as const;
export type TipoTarjeta = (typeof TIPOS_TARJETA)[number]['valor'];

export interface DatosComercio {
  nombre: string;
  slug: string;
  color_fondo: string;
  color_texto: string;
  color_label: string;
  logo_url: string | null;
  strip_url: string | null;
  hero_url: string | null;
  tipo_tarjeta: string;
  // La cuenta (cliente que paga) a la que pertenece el comercio. Obligatorio en la capa app —
  // la columna es nullable en la BD a propósito (migración 0008), así que validar() es la única
  // defensa, igual que con los colores.
  cuenta_id: string;
}

export type ResultadoGuardar =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Un opcional vacío es null, no ''. El formulario HTML de la Tarea 9 manda siempre string:
// un campo que el usuario dejó en blanco llega como '', y guardarlo tal cual metería cadenas
// vacías donde la columna espera NULL.
function limpiarOpcional(valor: string | null): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

// Normaliza ANTES de validar para que se valide EXACTAMENTE lo que se almacena. Sin esto,
// validarColorRgb —que hace su propio .trim() interno— aprobaría '  rgb(0,0,0)  ' y el valor
// se guardaría con los espacios puestos.
function normalizar(datos: DatosComercio): DatosComercio {
  return {
    ...datos,
    nombre: datos.nombre.trim(),
    slug: datos.slug.trim(),
    color_fondo: datos.color_fondo.trim(),
    color_texto: datos.color_texto.trim(),
    color_label: datos.color_label.trim(),
    logo_url: limpiarOpcional(datos.logo_url),
    strip_url: limpiarOpcional(datos.strip_url),
    hero_url: limpiarOpcional(datos.hero_url),
    tipo_tarjeta: datos.tipo_tarjeta.trim(),
    cuenta_id: datos.cuenta_id.trim(),
  };
}

// Devuelve el primer problema encontrado, o null si todo está bien.
// TODA la validación vive aquí, no en los Server Actions: esta es la capa con tests de
// integración. Una regla que solo exista en la acción no está cubierta por ninguna prueba.
function validar(datos: DatosComercio): string | null {
  // La cuenta va primero: sin ella no hay contra qué verificar el límite de negocios, y la BD la
  // acepta null sin chistar (columna nullable de la 0008) — validar() es la única defensa.
  if (!datos.cuenta_id) return 'La cuenta es obligatoria.';
  if (!datos.nombre) return 'El nombre es obligatorio.';
  if (!/^[a-z0-9-]+$/.test(datos.slug)) {
    return 'El slug solo puede tener minúsculas, números y guiones.';
  }
  if (!TIPOS_TARJETA.some((t) => t.valor === datos.tipo_tarjeta)) {
    // Sin esto, un valor inválido cae en un 23514 de la BD que el manejo de errores (solo
    // distingue 23505) convierte en un genérico "No se pudo crear el comercio". Se valida contra
    // los 8 valores válidos de la BD (no solo los `disponible`): el <select> ya deshabilita los no
    // disponibles, y el pass renderiza cualquier tipo != 'sellos' como número de forma segura, así
    // que un tipo no disponible guardado no rompe nada.
    return 'El tipo de tarjeta no es válido.';
  }
  const colores: [string, string][] = [
    ['color de fondo', datos.color_fondo],
    ['color de texto', datos.color_texto],
    ['color de etiqueta', datos.color_label],
  ];
  for (const [nombre, valor] of colores) {
    if (!validarColorRgb(valor)) {
      return `El ${nombre} debe tener el formato rgb(r, g, b) con valores de 0 a 255.`;
    }
  }
  return null;
}

export async function crearComercio(
  supabase: SupabaseClient<Database>,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  // El límite de negocios de la cuenta se aplica ANTES del insert: crear un comercio consume un
  // cupo, así que una cuenta llena debe rechazar el alta con un mensaje claro (no un error de BD).
  const limite = await verificarLimiteCuenta(supabase, limpios.cuenta_id);
  if (!limite.ok) return { ok: false, error: limite.error };

  const { data, error } = await supabase.from('comercios').insert(limpios).select('id').single();

  if (error) {
    // 23505 = unique violation. El único unique aquí es el slug.
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe un comercio con el slug "${limpios.slug}".` };
    }
    console.error('[fm] falló el insert de comercio:', error);
    return { ok: false, error: 'No se pudo crear el comercio.' };
  }

  // Todo comercio nace con su sucursal "Principal" (0012). Best-effort: si este insert falla, el
  // comercio igual queda creado (ok:true) — la primera sucursal creada a mano se vuelve principal
  // (auto-reparación en crearSucursal); no se le niega el alta al admin por esto.
  const principal = await crearSucursalPrincipal(supabase, data.id);
  if (!principal.ok) {
    console.error('[fm] el comercio quedó sin sucursal principal:', data.id);
  }

  // Todo comercio nace con su programa PRINCIPAL (0024). Mismo criterio best-effort que la
  // sucursal de arriba (no negarle el alta al admin por esto) — pero a diferencia de la sucursal,
  // ACÁ no hay auto-reparación posible desde la pantalla de programas (crearPrograma nunca crea un
  // es_principal:true): un fallo deja al comercio SIN poder recibir clientes hasta arreglarlo a
  // mano en Studio. Se loguea fuerte a propósito — ver migración 0025 para el precedente real.
  const programaPrincipal = await crearProgramaPrincipal(supabase, data.id, limpios.nombre, limpios.tipo_tarjeta);
  if (!programaPrincipal.ok) {
    console.error('[fm] URGENTE: el comercio quedó SIN programa principal, no puede recibir clientes:', data.id);
  }

  return { ok: true, id: data.id };
}

// El slug es editable a propósito, aunque sea la URL del QR físico pegado en la tienda
// (/registro/[comercioSlug]). Un typo al crear ("cafeteria-pilotoo") tiene que poder arreglarse, y
// volverlo inmutable obligaría a borrar y recrear, arrastrando las tarjetas existentes.
// Lo que SÍ se rompe al cambiarlo: los registros nuevos desde el QR ya impreso, que caen en un
// "Comercio no encontrado" silencioso — sin error, sin log, sin alerta. Lo que NO se rompe: los
// passes ya emitidos, cuyo código de barras es tarjetas.qr_token, no el slug. Por eso el
// formulario de la Tarea 9 debe pedir confirmación explícita al cambiar el slug de un comercio
// que ya existe.
// Lleva el tipo que eligió FM al programa PRINCIPAL, que es el que rige de verdad desde la 0024.
//
// ══ POR QUÉ SE NIEGA CUANDO YA HAY TARJETAS ══
// `tarjetas.puntos_actuales` es un contador universal cuyo SIGNIFICADO depende del tipo: en sellos
// son sellos, en gift card y cashback son CENTAVOS. Cambiarle el tipo a un programa con tarjetas
// vivas convierte el saldo de cada cliente en otra cosa sin tocar un solo número — los $12.50 de
// alguien pasan a ser 1250 sellos. Por eso `guardarConfiguracionPrograma` tampoco deja cambiar el
// tipo, y acá se sostiene la misma regla en vez de abrirle una puerta lateral desde el panel de FM.
//
// Un comercio SIN tarjetas emitidas sí puede cambiar de tipo: no hay ningún saldo que reinterpretar,
// y es el caso real (FM lo dio de alta con el tipo equivocado y lo corrige antes de entregarlo).
async function propagarTipoAlProgramaPrincipal(
  supabase: SupabaseClient<Database>,
  comercioId: string,
  tipoTarjeta: string,
): Promise<ResultadoGuardar> {
  const { data: principal, error: eLeer } = await supabase
    .from('programas_tarjeta')
    .select('id, tipo_tarjeta')
    .eq('comercio_id', comercioId)
    .eq('es_principal', true)
    .maybeSingle();
  if (eLeer) {
    // Falla CERRADO: sin saber qué tiene el programa no se puede decidir si el cambio es seguro.
    console.error('[fm] no se pudo leer el programa principal para propagar el tipo:', eLeer);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }
  // Comercio legado sin programa principal (no debería existir desde la 0025): no hay nada que
  // propagar y no se le niega el resto de la edición por eso.
  if (!principal) return { ok: true, id: comercioId };
  if (principal.tipo_tarjeta === tipoTarjeta) return { ok: true, id: comercioId };

  const { count, error: eContar } = await supabase
    .from('tarjetas')
    .select('id', { count: 'exact', head: true })
    .eq('programa_id', principal.id);
  if (eContar) {
    console.error('[fm] no se pudo contar las tarjetas del programa principal:', eContar);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }
  const emitidas = count ?? 0;
  if (emitidas > 0) {
    return {
      ok: false,
      error:
        `No se puede cambiar el tipo: el programa principal ya tiene ${emitidas} ` +
        `${emitidas === 1 ? 'tarjeta' : 'tarjetas'} de clientes, y el saldo de cada una significa ` +
        'otra cosa según el tipo. Creá un programa nuevo con el tipo que querés.',
    };
  }

  const { error } = await supabase
    .from('programas_tarjeta')
    .update({ tipo_tarjeta: tipoTarjeta })
    .eq('id', principal.id);
  if (error) {
    console.error('[fm] no se pudo propagar el tipo al programa principal:', error);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }
  return { ok: true, id: comercioId };
}

export async function actualizarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
  datos: DatosComercio,
): Promise<ResultadoGuardar> {
  const limpios = normalizar(datos);
  const problema = validar(limpios);
  if (problema) return { ok: false, error: problema };

  // Si el edit MUEVE el comercio a otra cuenta, la cuenta DESTINO tiene que tener cupo. Se lee el
  // cuenta_id actual y solo se verifica cuando cambia: reguardar el mismo comercio en su cuenta no
  // debe bloquearse a sí mismo (por eso el excluyendoComercioId). Si el comercio ya no existe, la
  // lectura no devuelve fila (data:null, error:null) y se salta el chequeo — el update de abajo lo
  // reporta con PGRST116. Un ERROR de la lectura (infra), en cambio, falla CERRADO: no se puede
  // saltar el chequeo de límite por un fallo transitorio (coherente con verificarLimiteCuenta).
  const { data: actual, error: eActual } = await supabase
    .from('comercios')
    .select('cuenta_id')
    .eq('id', id)
    .maybeSingle();
  if (eActual) {
    console.error('[fm] no se pudo leer el comercio para verificar el límite:', eActual);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }
  if (actual && actual.cuenta_id !== limpios.cuenta_id) {
    // El comercio que cambia de cuenta trae sus propias sucursales — igual que
    // asignarComercioACuenta en cuentas.ts, hay que contarlas y pasarlas como unidadesAAgregar.
    const { count: sucursalesPropias, error: eSucursales } = await supabase
      .from('sucursales').select('id', { count: 'exact', head: true }).eq('comercio_id', id)
      .eq('es_principal', false); // CONTROL: la principal viaja gratis con su comercio
    if (eSucursales) {
      console.error('[fm] no se pudo contar las sucursales del comercio a reasignar:', eSucursales);
      return { ok: false, error: 'No se pudo actualizar el comercio.' };
    }
    const limite = await verificarLimiteCuenta(supabase, limpios.cuenta_id, {
      excluyendoComercioId: id,
      unidadesAAgregar: 1 + (sucursalesPropias ?? 0),
    });
    if (!limite.ok) return { ok: false, error: limite.error };
  }

  // ── El tipo de tarjeta tiene que llegar al PROGRAMA, o el guardado miente ────────────────────
  // Desde la 0024, el tipo que rige de verdad —el que dibuja el pase, el que el escáner usa para
  // elegir la operación, el que leen los reportes— vive en `programas_tarjeta`. Esta función
  // escribía SOLO la columna de `comercios`, así que FM cambiaba el tipo, veía el valor nuevo
  // guardado, y para el comercio no cambiaba absolutamente nada.
  //
  // Se verifica ANTES del update del comercio: si el cambio no se puede propagar, tampoco se
  // escribe la columna legada, y así las dos tablas no quedan diciendo cosas distintas.
  const cambio = await propagarTipoAlProgramaPrincipal(supabase, id, limpios.tipo_tarjeta);
  if (!cambio.ok) return cambio;

  const { error } = await supabase
    .from('comercios')
    .update(limpios)
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe otro comercio con el slug "${limpios.slug}".` };
    }
    // PGRST116 = la consulta no devolvió exactamente una fila. El .select('id').single() de
    // arriba NO es decorativo: sin él, un update que no toca NADA devuelve 204 sin error y esto
    // reportaría ok:true habiendo escrito cero. Y .select('id') solo tampoco basta — devuelve []
    // sin error; hace falta el .single(). Dos rutas llegan aquí: un id que ya no existe, o un
    // cliente sin permiso — comercios es deny-all bajo RLS desde la 0001, así que pasar un
    // createClienteServidor() haría no-op silencioso en TODOS los updates.
    if (error.code === 'PGRST116') {
      return { ok: false, error: 'Ese comercio ya no existe.' };
    }
    console.error('[fm] falló el update de comercio:', error);
    return { ok: false, error: 'No se pudo actualizar el comercio.' };
  }

  return { ok: true, id };
}

// Ningún FK hacia comercios tiene ON DELETE CASCADE (migración 0001: usuarios_comercio,
// tarjetas, reglas_puntos y recompensas apuntan aquí sin cascada; migración 0008: sucursales
// también) — a propósito, para que borrar un comercio NUNCA arrastre en silencio datos reales de
// un cliente. Postgres es la única fuente de verdad de esa regla: no la duplicamos contando filas
// en JS, que podría desincronizarse si el esquema cambia. Solo traducimos el 23503 a un mensaje
// legible.
//
// LAS ÚNICAS EXCEPCIONES son la sucursal PRINCIPAL (0012) y el programa PRINCIPAL (0024), que se
// retiran antes del delete y se reponen verbatim si el delete no procede. Sin eso, ningún comercio
// con principal (o sea, NINGÚN comercio desde la 0024 — todos nacen con uno) sería borrable jamás
// y el 23503 mentiría diciendo "tiene datos asociados".
//
// Y NO se asume que la principal sea una fila "del sistema": muy a menudo es del DUEÑO. El backfill
// de la 0012 ascendió a principal la sucursal más antigua que ya existía —con el nombre que él le
// puso: en producción la principal de "Verde Raíz" se llama "Centro Santa Ana"—, la auto-reparación
// de crearSucursal asciende la primera que el dueño cree a mano, y renombrarSucursal la deja
// renombrar sin candado. Se retira igual, y eso es una DECISIÓN DE PRODUCTO, no un tecnicismo: un
// comercio solo llega a borrarse si está vacío de actividad (sin tarjetas, reglas, recompensas,
// cajeros ni transacciones), y una sucursal no significa nada sin el comercio al que pertenece. El
// invariante que el proyecto protege es no arrastrar datos de CLIENTES; una sucursal es estructura
// del comercio. Las sucursales ADICIONALES sí siguen bloqueando el borrado, como antes.
//
// DEUDA CONOCIDA — las membresías (usuarios_comercio) NO se retiran, así que un comercio con dueño
// o cajeros NO se puede borrar desde el panel. Aplica a TODO comercio creado self-serve:
// crearComercioPropio siempre le inserta su membresía owner. Se evaluó retirarlas por simetría con
// la principal y se decidió que NO, por tres razones:
//   1. Esa tabla es soft-delete POR POLÍTICA ESCRITA del proyecto (migración 0009 y desactivarCajero:
//      "NUNCA .delete()"). El ledger atribuye por usuarios_comercio.id —transacciones_puntos y
//      canjes tienen FK ahí— y para dar de baja sin borrar se agregó la columna `activo`. Esta sería
//      la única ruta del repo que borra esas filas.
//   2. La ventana sin atomicidad de más abajo es tolerable para una sucursal, pero perder una
//      membresía owner deja al dueño SIN VER su propio comercio (membresiasDeUsuario filtra por
//      membresía) con las tarjetas de sus clientes adentro; y el panel de FM solo LEE
//      usuarios_comercio —no hay UI para reponerla—, así que se arreglaría a mano en la BD.
//   3. Esa ventana se ejercita en el camino COMÚN, no en el raro: es justo el clic de FM sobre un
//      comercio con tarjetas, el que falla y repone.
// La cura correcta es de esquema, no de capa app: `on delete cascade` en usuarios_comercio.comercio_id
// (el ledger seguiría bloqueando por su propio FK) o un RPC transaccional como los de la 0009.
// Mientras tanto el mensaje nombra los accesos, para que el admin no salga a buscar tarjetas que no
// existen, y FM puede limpiar el comercio desde Studio.
//
// PRECONDICIÓN: `supabase` DEBE ser createServiceClient(). Un id ya borrado da ok:true a
// propósito (idempotente) — pero eso solo es seguro si `supabase` ignora RLS. Con un cliente
// de sesión, comercios es deny-all desde la 0001: un update bloqueado por RLS y un id que ya
// no existe devolverían el mismo ok:true, indistinguibles. No se agrega .select().single()
// para detectarlo (a diferencia de actualizarComercio) porque eso rompería la idempotencia
// legítima del caso "ya borrado" — la única defensa real es no llamar esto con otro cliente.
export async function eliminarComercio(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Se lee la principal ENTERA antes de retirarla porque hay que poder reponerla IDÉNTICA si el
  // borrado no procede: mismo id, mismo nombre, misma fecha. El nombre en particular es dato del
  // DUEÑO —puede haberlo puesto él y puede haberla renombrado—, así que reponer un genérico
  // "Principal" sería renombrarle la sucursal en silencio desde un botón que no borró nada. Sin
  // fila (comercio legado o alta cuyo best-effort falló) no hay nada que retirar ni que reponer.
  const [{ data: principal, error: eLeer }, { data: programaPrincipal, error: eLeerPrograma }] = await Promise.all([
    supabase
      .from('sucursales')
      .select('id, nombre, activa, created_at')
      .eq('comercio_id', id)
      .eq('es_principal', true)
      .maybeSingle(),
    // Mismo criterio que la sucursal: se lee ENTERO (no solo el id) para poder reponerlo IDÉNTICO
    // si el borrado no procede — incluida su configuración, que el dueño puede haber cargado.
    supabase
      .from('programas_tarjeta')
      .select('id, nombre, slug, tipo_tarjeta, activo, sello_meta, cashback_porcentaje, multipass_visitas, membresia_dias, cupon_vigencia_dias, created_at')
      .eq('comercio_id', id)
      .eq('es_principal', true)
      .maybeSingle(),
  ]);
  if (eLeer || eLeerPrograma) {
    // Falla CERRADO: sin saber qué reponer no se puede arriesgar el retiro.
    console.error('[fm] no se pudo leer la principal antes de borrar el comercio:', eLeer ?? eLeerPrograma);
    return { ok: false, error: 'No se pudo eliminar el comercio.' };
  }

  if (principal) {
    const { error: eRetirar } = await supabase
      .from('sucursales').delete().eq('id', principal.id).eq('comercio_id', id);
    if (eRetirar) {
      console.error('[fm] no se pudo retirar la sucursal principal antes de borrar el comercio:', eRetirar);
      // 23503 acá = algo REFERENCIA a la principal: un cajero asignado a ella (usuarios_comercio.
      // sucursal_id), o una transacción o un canje atribuidos (0008). Eso es actividad real y el
      // borrado debe rechazarse — pero nombrando la causa VERDADERA: hablar de tarjetas mandaría al
      // admin a buscar algo que no existe. Cualquier otro error (red, RLS) no es actividad: mensaje
      // genérico.
      if (eRetirar.code === '23503') {
        return {
          ok: false,
          error:
            'No se puede eliminar: la sucursal principal tiene actividad asociada (cajeros, transacciones o canjes). Solo se pueden eliminar comercios sin actividad.',
        };
      }
      return { ok: false, error: 'No se pudo eliminar el comercio.' };
    }
  }

  // Reponedor compartido: se llama desde CUALQUIER salida de error después de este punto, porque
  // la sucursal ya pudo haberse retirado arriba. Repetirlo en cada `return` (como en un primer
  // intento de este parche) es exactamente el bug que encontró la prueba: una rama devolvía el
  // error de "tiene tarjetas" ANTES de reponer, dejando el comercio con su sucursal borrada aunque
  // eliminarComercio hubiera devuelto ok:false.
  async function reponerSucursalSiHaceFalta() {
    if (!principal) return;
    const { error: eReponer } = await supabase.from('sucursales').insert({
      id: principal.id, comercio_id: id, nombre: principal.nombre,
      activa: principal.activa, created_at: principal.created_at, es_principal: true,
    });
    if (eReponer) {
      console.error('[fm] el comercio quedó sin su sucursal principal tras un borrado fallido:', id, eReponer);
    }
  }

  if (programaPrincipal) {
    const { error: eRetirarPrograma } = await supabase
      .from('programas_tarjeta').delete().eq('id', programaPrincipal.id).eq('comercio_id', id);
    if (eRetirarPrograma) {
      console.error('[fm] no se pudo retirar el programa principal antes de borrar el comercio:', eRetirarPrograma);
      await reponerSucursalSiHaceFalta();
      // 23503 acá SOLO puede ser tarjetas.programa_id (es la única FK hacia programas_tarjeta):
      // el comercio tiene clientes reales bajo su programa principal.
      if (eRetirarPrograma.code === '23503') {
        return {
          ok: false,
          error:
            'No se puede eliminar: el programa principal tiene tarjetas de clientes. Solo se pueden eliminar comercios sin actividad.',
        };
      }
      return { ok: false, error: 'No se pudo eliminar el comercio.' };
    }
  }

  // VENTANA SIN ATOMICIDAD: entre los retiros de arriba y este delete no hay transacción
  // (supabase-js no las expone; haría falta un RPC como el de la 0009). Si el proceso muere justo
  // acá, el comercio queda sin principal. La sucursal se auto-repara sola si no le quedan otras
  // (crearSucursal asciende la primera); el programa NO tiene auto-reparación equivalente
  // (crearPrograma nunca crea un es_principal:true) — arreglo manual entonces, o la cura de raíz:
  // `on delete cascade` en sucursales/programas_tarjeta.comercio_id, que borraría esta danza.
  const { error } = await supabase.from('comercios').delete().eq('id', id);

  if (error) {
    // El comercio sigue vivo (un id inexistente NO da error: el delete es idempotente a propósito),
    // así que hay que devolverle su principal TAL CUAL estaba. Mismo id: nada podía apuntarle (si
    // algo lo hiciera, el retiro habría dado 23503 y no habríamos llegado hasta acá), así que el
    // insert no choca con ningún FK ni con el índice parcial único.
    await reponerSucursalSiHaceFalta();
    if (programaPrincipal) {
      const { error: eReponerPrograma } = await supabase.from('programas_tarjeta').insert({
        id: programaPrincipal.id,
        comercio_id: id,
        nombre: programaPrincipal.nombre,
        slug: programaPrincipal.slug,
        tipo_tarjeta: programaPrincipal.tipo_tarjeta,
        es_principal: true,
        activo: programaPrincipal.activo,
        sello_meta: programaPrincipal.sello_meta,
        cashback_porcentaje: programaPrincipal.cashback_porcentaje,
        multipass_visitas: programaPrincipal.multipass_visitas,
        membresia_dias: programaPrincipal.membresia_dias,
        cupon_vigencia_dias: programaPrincipal.cupon_vigencia_dias,
        created_at: programaPrincipal.created_at,
      });
      if (eReponerPrograma) {
        console.error('[fm] el comercio quedó sin su programa principal tras un borrado fallido:', id, eReponerPrograma);
      }
    }
    if (error.code === '23503') {
      // Los "accesos de dueño/cajero" (usuarios_comercio) NO son un adorno de la lista: son la causa
      // MÁS común, porque todo comercio creado self-serve nace con su membresía owner y esta función
      // no la retira (ver DEUDA CONOCIDA en la cabecera). Sin nombrarlos, el admin sale a buscar
      // tarjetas, reglas o recompensas que no existen. "Programas" cubre los ADICIONALES (no el
      // principal, que ya se retiró arriba): igual que las sucursales adicionales, siguen bloqueando.
      return {
        ok: false,
        error:
          'No se puede eliminar: tiene datos asociados (tarjetas, reglas de puntos, recompensas, sucursales, programas adicionales o accesos de dueño/cajero). Solo se pueden eliminar comercios sin actividad.',
      };
    }
    console.error('[fm] falló el borrado de comercio:', error);
    return { ok: false, error: 'No se pudo eliminar el comercio.' };
  }

  return { ok: true };
}
