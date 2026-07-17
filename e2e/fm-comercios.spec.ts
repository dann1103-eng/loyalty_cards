import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_FM_EMAIL;
const PASSWORD = process.env.E2E_FM_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Define E2E_FM_EMAIL y E2E_FM_PASSWORD en .env.local para este flujo.');

test('FM inicia sesión, crea, edita y elimina un comercio', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Correo').fill(EMAIL!);
  await page.getByLabel('Contraseña').fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/admin\/comercios/);

  const slug = `e2e-${Date.now()}`;
  await page.getByRole('link', { name: /nuevo comercio/i }).click();
  await page.getByLabel('Nombre').fill('Comercio E2E');
  await page.getByLabel(/slug/i).fill(slug);
  await page.getByLabel('Color de fondo').fill('rgb(35, 24, 18)');
  await page.getByLabel('Color de texto').fill('rgb(255, 255, 255)');
  await page.getByLabel('Color de etiqueta').fill('rgb(255, 255, 255)');
  await page.getByRole('button', { name: /crear comercio/i }).click();
  await expect(page).toHaveURL(/\/admin\/comercios/);
  await expect(page.getByText('Comercio E2E')).toBeVisible();

  // Editar
  await page.getByText('Comercio E2E').click();
  await page.getByLabel('Nombre').fill('Comercio E2E Editado');
  await page.getByRole('button', { name: /guardar cambios/i }).click();
  await expect(page.getByText('Comercio E2E Editado')).toBeVisible();

  // Eliminar (autolimpieza). Acepta el window.confirm.
  await page.getByText('Comercio E2E Editado').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /eliminar comercio/i }).click();
  await expect(page).toHaveURL(/\/admin\/comercios/);
  await expect(page.getByText('Comercio E2E Editado')).toHaveCount(0);
});
