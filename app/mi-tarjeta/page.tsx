import { headers } from 'next/headers';
import { detectarPlataforma } from '@/lib/clientes/plataforma';
import PortalCliente from './PortalCliente';

export const dynamic = 'force-dynamic';

export default async function PaginaMiTarjeta() {
  // Del lado del SERVIDOR (spec Wallet/logos §1), mismo patrón que app/registro/[comercioSlug]/
  // page.tsx: la primera pintura ya muestra el botón de Wallet correcto, sin desajuste de
  // hidratación entre servidor y cliente.
  const plataforma = detectarPlataforma((await headers()).get('user-agent'));
  return <PortalCliente plataforma={plataforma} />;
}
