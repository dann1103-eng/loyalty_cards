import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { leerControles, type ControlesAcreditacion } from '@/lib/comercio/controlesAcreditacion';
import { listarProgramas } from '@/lib/comercio/programas';
import { ofreceReglaDeMonto as calcularOfreceReglaDeMonto } from '@/lib/comercio/montoAcreditacion';
import { unidadPrograma, type Unidad } from '@/lib/tarjetas/unidadPrograma';
import { aplicanControlesAcreditacion, usaMontoDeCompra as calcularUsaMontoDeCompra } from '@/lib/tarjetas/tipos';

// Sin 'use server': esto no es un Server Action, es una función de datos que llaman DOS lugares —
// page.tsx (para dibujar la pantalla) y reglas/actions.test.ts (para dibujar el MISMO formulario en
// la prueba, con `dibujarReglas`). Antes de esta revisión, la prueba tenía su PROPIA copia de la
// llamada `listarProgramas(…, { soloActivos: false })` en vez de compartir esta función, y una
// mutación que le sacara esas opciones a page.tsx no la atrapaba ninguna prueba — exactamente el
// defecto que describe el CLAUDE.md del proyecto ("un reemplazo en todos los sitios de llamada asume
// que todos hacen lo mismo, y casi nunca es cierto"; "cargá la configuración por el camino de
// producción"). Con esta función como único punto de entrada, page.tsx y la prueba corren el MISMO
// código, y una mutación acá las rompe a las dos por igual.

export interface DatosFormularioControles {
  // null si `leerControles` falla: page.tsx sigue mostrando su mensaje de error como hoy, y
  // `dibujarReglas` (la prueba) sigue lanzando si lo recibe en null — ninguno de los dos cambia ese
  // comportamiento acá.
  controles: ControlesAcreditacion | null;
  tipoPrincipal: string;
  unidad: Unidad | null;
  aplicanLimites: boolean;
  usaMontoDeCompra: boolean;
  ofreceReglaDeMonto: boolean;
}

export async function datosFormularioControles(
  supabase: SupabaseClient<Database>,
  comercioId: string,
): Promise<DatosFormularioControles> {
  // Los controles antifraude (Tanda 1) viven acá y no en Marca porque son política de acreditación,
  // no imagen — y así no hace falta un sexto destino en la barra, que descentraría el botón de
  // Escanear (ver lib/comercio/navegacion.ts).
  const controles = await leerControles(supabase, comercioId);

  // El tipo sale del programa PRINCIPAL, no de comercios.tipo_tarjeta (columna legada desde la
  // 0024). Con la columna vieja, un comercio al que FM le cambió el tipo sin propagarlo veía el
  // formulario antifraude equivocado: los campos de "puntos" en un programa de sellos, o al revés.
  //
  // { soloActivos: false }: el default de listarProgramas filtra los activos, pero acá hacen falta
  // TODOS. Para el principal es seguro buscarlo en la lista completa —desactivarPrograma filtra
  // es_principal = false, así que el principal nunca se desactiva—, y ofreceReglaDeMonto (Tarea 4)
  // necesita ver también los programas SECUNDARIOS desactivados: sus tarjetas se siguen escaneando
  // y acreditando, así que la regla de monto les sigue aplicando.
  const programas = await listarProgramas(supabase, comercioId, { soloActivos: false });
  const principal = (programas ?? []).find((p) => p.esPrincipal) ?? null;
  const tipoPrincipal = principal?.tipoTarjeta ?? 'puntos';
  const unidad = unidadPrograma(tipoPrincipal);
  // Los cuatro límites antifraude viven DENTRO de acreditar_atomico (0015). En cupón, membresía y
  // descuento la operación del mostrador es otra función (0019, 0023) que no los consulta: el
  // dueño estaba configurando perillas que su tarjeta nunca lee.
  const aplicanLimites = aplicanControlesAcreditacion(tipoPrincipal);
  // Mismo razonamiento para la casilla del monto: en cupón, membresía y prepago ninguna operación
  // del mostrador le entrega el monto a su RPC, así que la casilla era una perilla muerta. El
  // detalle, tipo por tipo, está en `usaMontoDeCompra` (lib/tarjetas/tipos.ts).
  const usaMonto = calcularUsaMontoDeCompra(tipoPrincipal);
  // ¿Algún programa —principal o secundario— es de puntos o sellos? Decide si se le ofrece al dueño
  // el sub-bloque nuevo de exigir/mínimo (Tarea 4, lib/comercio/montoAcreditacion.ts).
  //
  // `programas === null || …`: si listarProgramas falla, no hay forma de saber si algún programa
  // ofrece la regla — y es un camino NUEVO desde la Tarea 4. Antes, esta misma degradación
  // (tipoPrincipal cae a 'puntos', como si el comercio no tuviera programas) no perdía nada. Ahora
  // sí: si `leerControles` funcionó y el comercio tenía exigir/mínimo configurados, un
  // `ofreceReglaDeMonto` en false escondería el sub-bloque, y GUARDAR cualquier otro campo del
  // formulario resetearía exigir/mínimo a false/null en silencio (rama del sub-bloque ausente de
  // FormularioControles) — el dueño perdería su mínimo sin ninguna señal de que pasó. Por eso, ante
  // una lectura fallida, se degrada hacia MOSTRAR el sub-bloque, nunca hacia esconderlo y borrarlo:
  // un campo de más en un comercio que en realidad no lo necesita es un costo menor que borrar
  // configuración real sin que el dueño se entere.
  const ofreceMonto = programas === null || calcularOfreceReglaDeMonto(programas);

  return {
    controles,
    tipoPrincipal,
    unidad,
    aplicanLimites,
    usaMontoDeCompra: usaMonto,
    ofreceReglaDeMonto: ofreceMonto,
  };
}
