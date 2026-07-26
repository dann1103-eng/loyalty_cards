import { verifyComercioAcceso } from '@/lib/comercio/verifyComercioAcceso';

// Recordatorio de QUÉ comercio se está configurando, para las pantallas de ajustes (marca, premios,
// reglas, sucursales, cajeros). Nace de un susto real en producción (2026-07-26): el dueño creó un
// comercio nuevo —el alta lo switchea al nuevo, a propósito—, volvió a entrar más tarde y encontró
// la pantalla de marca vacía. Creyó que la app le había borrado el logo y el ícono de sellos; en
// realidad estaba parado en el comercio nuevo. El nombre SÍ estaba en el header, pero ahí se lee
// como decoración: en una pantalla de ajustes, "vacío" y "se borró todo" se ven igual.
//
// Solo aparece con 2+ comercios propios: con uno solo no hay ambigüedad posible y sería ruido en
// todas las pantallas. Aparece solo el día que el dueño suma su segunda marca, sin configurar nada.
//
// No cuesta consultas: verifyComercioAcceso está memoizado por render con cache() y la página que
// lo incluye ya lo llamó para su propio gate.
export default async function AvisoComercioActivo() {
  const { nombre, membresias } = await verifyComercioAcceso();

  const comerciosPropios = membresias.filter((m) => m.rol === 'owner').length;
  if (comerciosPropios < 2) return null;

  return (
    <p className="aviso-contexto" role="status">
      <span className="icono" aria-hidden="true" style={{ fontSize: 16 }}>storefront</span>
      Estás configurando <strong>{nombre}</strong>
    </p>
  );
}
