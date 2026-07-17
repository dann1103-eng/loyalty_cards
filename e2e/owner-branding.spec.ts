import { test, expect } from '@playwright/test';
import path from 'node:path';

const EMAIL = process.env.E2E_OWNER_EMAIL;
const PASSWORD = process.env.E2E_OWNER_PASSWORD;

test.skip(!EMAIL || !PASSWORD, 'Define E2E_OWNER_EMAIL y E2E_OWNER_PASSWORD en .env.local para este flujo.');

test('el dueño edita branding y sube una imagen que se refleja', async ({ page }) => {
  await page.goto('/comercio/login');
  await page.getByLabel('Correo').fill(EMAIL!);
  await page.getByLabel('Contraseña').fill(PASSWORD!);
  await page.getByRole('button', { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/comercio\/panel/);

  await page.goto('/comercio/branding');
  await page.getByLabel('Color de fondo').fill('rgb(20, 40, 60)');
  await page.getByRole('button', { name: /guardar branding/i }).click();
  await expect(page.getByText(/branding guardado/i)).toBeVisible();

  // Subir el logo y verificar que aparece una vista previa (<img> con la URL pública + ?v=).
  // Hay un botón "Subir" por imagen: se apunta al form que contiene #archivo-logo con :has()
  // (un <form> sin nombre accesible NO tiene rol ARIA "form", así que getByRole('form') no sirve).
  await page.setInputFiles('#archivo-logo', path.join(__dirname, 'fixtures', 'logo.png'));
  await page.locator('form:has(#archivo-logo)').getByRole('button', { name: /subir/i }).click();
  await expect(page.locator('img.subida-preview').first()).toBeVisible();
});
