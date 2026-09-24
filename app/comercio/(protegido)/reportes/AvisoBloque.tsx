// El aviso de un bloque de Reportes cuya lectura falló (una RPC de la 0040 que devolvió `null`). Va EN
// LUGAR de los números, nunca junto a unos ceros: un cero ahí se lee como "no hubo actividad", que es
// la conclusión opuesta a "no se pudo leer" (spec 2026-09-23 §2; el mismo criterio que la pantalla de
// cajeros con reporteCajeros). Compacto (.alerta) y no el .admin-error grande: el resto de la página
// puede estar bien, y el aviso es de ESTE bloque.
export function AvisoBloque() {
  return (
    <p className="alerta" role="alert">
      No pudimos cargar esto. Recargá la página.
    </p>
  );
}
