import { MARCA } from '../marca';

// Datos de Cardly SV que van al pie del reverso de TODAS las tarjetas, de todos los comercios.
// Viven en codigo y no en la base a proposito: son nuestros, identicos para todos, y ponerlos en
// `comercios` invitaria a que un comercio los edite.
//
// Toma los valores de `lib/marca.ts` en vez de repetirlos: el mismo correo de soporte aparece en
// textos del panel del dueno, y dos copias divergen el dia que cambie.
//
// El sitio va CON `www` y SIN esquema. El `www` no es cosmetico: el dominio raiz redirige, y esa
// redireccion rompio el registro de passes en produccion el 2026-07-26 (ver
// docs/guia-pruebas-manuales-cuentas-sucursales.md). Sin esquema porque este texto lo linkifican los
// detectores de datos de iOS, que reconocen `www.` por su cuenta.
export const EMISOR_CARDLY = {
  nombre: MARCA.nombre,
  correo: MARCA.correoSoporte,
  sitio: MARCA.sitio,
} as const;
