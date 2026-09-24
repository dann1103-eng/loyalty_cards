// El aviso de un bloque de Reportes cuya lectura falló (una RPC de la 0040 que devolvió `null`). Va EN
// LUGAR de los números, nunca junto a unos ceros: un cero ahí se lee como "no hubo actividad", que es
// la conclusión opuesta a "no se pudo leer" (spec 2026-09-23 §2; el mismo criterio que la pantalla de
// cajeros con reporteCajeros). Compacto (.alerta) y no el .admin-error grande: el resto de la página
// puede estar bien, y el aviso es de ESTE bloque.
//
// `que` nombra el bloque ("los totales", "la serie por día", "las sucursales"): si falla el resumen,
// fallan tres bloques a la vez, y tres role="alert" idénticos no le dicen a nadie qué se perdió.
export function AvisoBloque({ que }: { que: string }) {
  return (
    <p className="alerta" role="alert">
      No pudimos cargar {que}. Recargá la página.
    </p>
  );
}
