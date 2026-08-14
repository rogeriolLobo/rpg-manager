import { expect, test } from '@playwright/test';

/**
 * Navigation invariants E2E — validates that the sidebar structure
 * matches the UX invariants defined in docs/product/UX_INVARIANTS.md.
 *
 * Covers desktop and mobile viewports, light and dark themes,
 * and the no-world-active state.
 *
 * Uses a single sequential test to avoid rate-limit issues
 * from multiple registrations.
 */

test('navegação global sem world ativo, deep links e tema', async ({ page }) => {
  test.setTimeout(45_000);

  const openNavigation = async () => {
    if ((page.viewportSize()?.width ?? 1000) <= 850) {
      await page.getByRole('button', { name: 'Abrir menu' }).click();
      await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    }
  };

  const assertGlobalLinksVisible = async () => {
    const sidebar = page.locator('.sidebar');
    await expect(sidebar.getByRole('link', { name: 'Visão geral' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Biblioteca' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Vault' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Grupos' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Campanhas' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Mundos' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Configurações' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Segurança' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Perfil' })).toBeVisible();
  };

  const assertWorldModulesNotVisible = async () => {
    const sidebar = page.locator('.sidebar');
    await expect(sidebar.getByRole('link', { name: 'Wiki' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Relações' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Timeline' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Bestiário' })).not.toBeVisible();
  };

  const assertSectionLabelsPresent = async () => {
    const sidebar = page.locator('.sidebar');
    await expect(sidebar.locator('.nav-section-label', { hasText: 'Geral' })).toBeVisible();
    await expect(sidebar.locator('.nav-section-label', { hasText: 'Sistema' })).toBeVisible();
  };

  // ── Register ──
  const email = `nav-e2e-${Date.now()}@example.com`;
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/register');
  await page.getByLabel('Como quer ser chamado?').fill('Nav E2E');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha mínimo de 12 caracteres').fill('uma senha longa para nav e2e 2026');
  await page.getByLabel('Confirmar senha').fill('uma senha longa para nav e2e 2026');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Guarde seus códigos' })).toBeVisible();
  await page.getByRole('link', { name: 'Já guardei, continuar' }).click();
  await expect(page).toHaveURL(/\/app$/u);

  // ── 1: Sidebar structure — no world active ──
  await openNavigation();
  await assertSectionLabelsPresent();
  await assertGlobalLinksVisible();
  await assertWorldModulesNotVisible();

  await test.info().attach('sidebar-no-world', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  // ── 2: Deep links — /app/campaigns ──
  await page.goto('/app/campaigns');
  await expect(page.getByRole('heading', { name: 'Planejador de mesas' })).toBeVisible();

  // ── 3: Deep links — /app/vault ──
  await page.goto('/app/vault');
  await expect(page.getByRole('heading', { name: 'Seu acervo de jogo' })).toBeVisible();

  // ── 4: Deep links — /app/worlds ──
  await page.goto('/app/worlds');
  await expect(page.getByRole('heading', { name: 'Seus mundos' })).toBeVisible();

  // ── 5: Theme switch doesn't alter navigation ──
  await openNavigation();
  await assertGlobalLinksVisible();
  await page.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('radio', { name: /Claro/u }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openNavigation();
  await assertGlobalLinksVisible();
  await assertWorldModulesNotVisible();
});
