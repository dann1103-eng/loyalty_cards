import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Corregido tras revisión: la versión anterior de este archivo no tenía forma de borrar lo que
// crea (solo tenía `page`/`request`) — cada corrida de `npm run e2e` habría dejado un cliente y
// una tarjeta huérfanos en la BD compartida de producción, para siempre. Se agrega un cliente
// de servicio y un afterEach que limpia por teléfono, sin importar si el test pasó o falló.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let telefonoDePrueba: string | null = null;

test.afterEach(async () => {
  if (!telefonoDePrueba) return;
  // Orden FK-safe: tarjeta (hijo) antes que cliente (padre) — mismo orden que usan los tests
  // de integración de Vitest en este proyecto.
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefono', telefonoDePrueba)
    .maybeSingle();
  if (cliente) {
    await supabase.from('tarjetas').delete().eq('cliente_id', cliente.id);
    await supabase.from('clientes').delete().eq('id', cliente.id);
  }
  telefonoDePrueba = null;
});

// Registro de cliente real en la Cafetería Piloto → el botón de Apple Wallet apunta a un .pkpass
// descargable con Content-Type correcto. Teléfono único por corrida para no chocar con el unique.
test('registro público entrega un pass descargable', async ({ page, request }) => {
  await page.goto('/registro/cafeteria-piloto');

  const telefono = `7${Date.now().toString().slice(-7)}`;
  // Se registra para limpieza ANTES del submit — si algo falla después, el afterEach igual
  // encuentra y borra el cliente si el registro alcanzó a crearlo.
  telefonoDePrueba = telefono;
  await page.getByLabel('Nombre').fill('Cliente E2E');
  await page.getByLabel('Teléfono').fill(telefono);
  await page.getByRole('button', { name: /crear mi tarjeta/i }).click();

  const enlace = page.getByRole('link', { name: /agregar a apple wallet/i });
  await expect(enlace).toBeVisible();

  const href = await enlace.getAttribute('href');
  expect(href).toMatch(/\/api\/tarjetas\/.+\/pass\.pkpass$/);

  // El endpoint responde un .pkpass real (no un 404/500).
  const resp = await request.get(href!);
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-type']).toContain('application/vnd.apple.pkpass');
});
