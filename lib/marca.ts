// Datos de marca de Cardly SV, en UN solo lugar.
//
// Existe porque el rebranding de FM Lealtad a Cardly SV dejó el nombre viejo repartido por textos
// de interfaz, y el dueño de un comercio llegó a ver "Hablá con FM para ampliarlo" en su panel: un
// nombre que para él no significa nada. Con el correo y el nombre repetidos en cada string, "¿los
// cambiamos todos?" no tiene respuesta verificable — con esta constante, sí.
//
// El sitio va CON `www` y SIN esquema: el dominio raíz redirige, y esa redirección rompió el
// registro de passes en producción el 2026-07-26.
export const MARCA = {
  nombre: 'Cardly SV',
  correoSoporte: 'soporte@cardly-sv.site',
  sitio: 'www.cardly-sv.site',
} as const;

// Frase de contacto lista para pegar al final de un mensaje de error dirigido al dueño de un
// comercio. Se centraliza para que todos los avisos suenen igual y para no repetir el correo en
// cada string (cambiarlo mañana sería siete ediciones y una olvidada).
export const ESCRIBINOS = `Escribinos a ${MARCA.correoSoporte}`;
