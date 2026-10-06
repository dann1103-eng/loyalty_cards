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
  // Buzón de FM Communications: el de @cardly-sv.site se dejó de pagar (2026-09-28).
  correoSoporte: 'soporte@fmcomsolutions.com',
  sitio: 'www.cardly-sv.site',
  // El Instagram de Cardly. CON `www` y SIN esquema, igual que el sitio y por el mismo motivo: va
  // como texto al pie del reverso del pase, y lo vuelven tocable los detectores de datos de iOS, que
  // reconocen `www.` por su cuenta. Sin los parámetros de seguimiento del link para compartir
  // (`stkn`, `utm_source`): son de quien copió el link, no de la cuenta.
  instagram: 'www.instagram.com/cardlysv',
} as const;

// Frase de contacto lista para pegar al final de un mensaje de error dirigido al dueño de un
// comercio. Se centraliza para que todos los avisos suenen igual y para no repetir el correo en
// cada string (cambiarlo mañana sería siete ediciones y una olvidada).
export const ESCRIBINOS = `Escribinos a ${MARCA.correoSoporte}`;
