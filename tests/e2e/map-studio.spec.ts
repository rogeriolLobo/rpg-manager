import { expect, test } from '@playwright/test';

test('Map Studio cria, edita e persiste mapa global sem World', async ({ page }) => {
  const stamp = Date.now();
  await page.goto('/register');
  await page.getByLabel('Como quer ser chamado?').fill('Map Studio E2E');
  await page.getByLabel('E-mail').fill(`map-studio-${stamp}@example.com`);
  await page.getByLabel('Senha mínimo de 12 caracteres').fill('uma senha longa map studio 2026');
  await page.getByLabel('Confirmar senha').fill('uma senha longa map studio 2026');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Guarde seus códigos' })).toBeVisible();
  await page.getByRole('link', { name: 'Já guardei, continuar' }).click();

  await page.goto('/app/maps');
  await expect(page.getByRole('heading', { name: 'Meus mapas' })).toBeVisible();
  await page.getByLabel('Nome').fill('Mapa One-Shot');
  await page.locator('input[type="file"][accept*="image/png"]').first().setInputFiles({
    name: 'map-studio-background.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByRole('button', { name: 'Criar mapa' }).click();

  await expect(page.getByRole('heading', { name: 'Mapa One-Shot' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Editor do mapa' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] image')).toHaveCount(1);
  await expect(page.getByText('Nenhum World disponível. O mapa continua utilizável.')).toBeVisible();

  await page.getByRole('button', { name: 'Retângulo' }).click();
  await expect(page.getByText('Alterações pendentes')).toBeVisible();
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refazer' }).click();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);
  await expect(page.getByText('Salvo', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mapa One-Shot' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);
});
