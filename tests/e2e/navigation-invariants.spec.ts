import { expect, test } from '@playwright/test';

/**
 * Navigation invariants E2E — validates that the sidebar structure
 * matches the UX invariants defined in docs/product/UX_INVARIANTS.md
 * and the actual AppShell implementation.
 *
 * Covers desktop and mobile viewports, light and dark themes,
 * no-world-active and active-world states.
 */

test('navegação global: estrutura por seções sem e com world ativo, deep links e tema', async ({ page }) => {
  test.setTimeout(90_000);

  const isMobile = () => (page.viewportSize()?.width ?? 1000) <= 850;

  const openNavigation = async () => {
    if (isMobile()) {
      await page.getByRole('button', { name: 'Abrir menu' }).click();
      await expect(page.locator('.sidebar')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
    }
  };

  const assertSectionsAndLinksNoWorld = async () => {
    const sidebar = page.locator('.sidebar');

    // Visão geral
    const visaoGeral = sidebar.getByRole('navigation', { name: 'Visão geral' });
    await expect(visaoGeral.locator('.nav-section-label')).toHaveText('Visão geral');
    await expect(visaoGeral.getByRole('link', { name: 'Painel', exact: true })).toBeVisible();

    // Biblioteca e conteúdo
    const biblioteca = sidebar.getByRole('navigation', { name: 'Biblioteca e conteúdo' });
    await expect(biblioteca.locator('.nav-section-label')).toHaveText('Biblioteca e conteúdo');
    await expect(biblioteca.getByRole('link', { name: 'Biblioteca', exact: true })).toBeVisible();
    await expect(biblioteca.getByRole('link', { name: 'Vault', exact: true })).toBeVisible();
    await expect(biblioteca.getByRole('link', { name: 'Compêndio', exact: true })).toBeVisible();
    await expect(biblioteca.getByRole('link', { name: 'Fichas', exact: true })).toBeVisible();

    // Mesas
    const mesas = sidebar.getByRole('navigation', { name: 'Mesas' });
    await expect(mesas.locator('.nav-section-label')).toHaveText('Mesas');
    await expect(mesas.getByRole('link', { name: 'Campanhas', exact: true })).toBeVisible();
    await expect(mesas.getByRole('link', { name: 'Minhas Mesas', exact: true })).toBeVisible();
    await expect(mesas.getByRole('link', { name: 'Grupos', exact: true })).toBeVisible();
    await expect(mesas.getByRole('link', { name: 'Amigos', exact: true })).toBeVisible();

    // Mundos
    const mundos = sidebar.getByRole('navigation', { name: 'Mundos' });
    await expect(mundos.locator('.nav-section-label')).toHaveText('Mundos');
    await expect(mundos.getByRole('link', { name: 'Mundos', exact: true })).toBeVisible();

    // Ferramentas
    const ferramentas = sidebar.getByRole('navigation', { name: 'Ferramentas' });
    await expect(ferramentas.locator('.nav-section-label')).toHaveText('Ferramentas');
    await expect(ferramentas.getByRole('link', { name: 'Ferramentas do Mestre', exact: true })).toBeVisible();

    // Sistema
    const sistema = sidebar.getByRole('navigation', { name: 'Sistema' });
    await expect(sistema.locator('.nav-section-label')).toHaveText('Sistema');
    await expect(sistema.getByRole('link', { name: 'Configurações', exact: true })).toBeVisible();
    await expect(sistema.getByRole('link', { name: 'Segurança', exact: true })).toBeVisible();
    await expect(sistema.getByRole('link', { name: 'Perfil', exact: true })).toBeVisible();
  };

  const assertWorldModulesNotVisible = async () => {
    const sidebar = page.locator('.sidebar');
    await expect(sidebar.getByRole('link', { name: 'Visão do World' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Wiki' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Diário' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Recursos externos' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Cartografia' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Relações' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Timeline' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Bestiário' })).not.toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Portal do jogador' })).not.toBeVisible();
  };

  // ── Register ──
  const timestamp = Date.now() + Math.floor(Math.random() * 10000);
  const email = `nav-e2e-${timestamp}@example.com`;
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/register');
  await page.getByLabel('Como quer ser chamado?').fill('Nav E2E');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha mínimo de 12 caracteres').fill('uma senha longa para nav e2e 2026');
  await page.getByLabel('Confirmar senha').fill('uma senha longa para nav e2e 2026');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Guarde seus códigos' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Já guardei, continuar' }).click();
  await expect(page).toHaveURL(/\/app$/u);

  // ── 1: Structure without active world ──
  await openNavigation();
  await assertSectionsAndLinksNoWorld();
  await assertWorldModulesNotVisible();

  // ── 2: Activate a World and verify contextual modules appear ──
  const csrfCookie = (await page.context().cookies()).find(c => c.name === 'rpg_csrf')?.value ?? '';
  const csrf = decodeURIComponent(csrfCookie);
  const worldName = `World Nav ${timestamp}`;
  const worldRes = await page.request.post('/api/v1/worlds', {
    headers: { 'X-CSRF-Token': csrf, Origin: 'http://127.0.0.1:5173' },
    data: { name: worldName, description: 'Test world navigation', defaultRpgId: null, visibility: 'PRIVATE' },
  });
  const resBody = (await worldRes.json()) as { item?: { id: string }; id?: string };
  const worldId = resBody.item?.id ?? resBody.id!;

  // Navigate to the world page to activate it in the app shell
  await page.goto(`/app/worlds/${worldId}`);
  await expect(page.getByRole('heading', { name: worldName })).toBeVisible({ timeout: 30_000 });

  // Verify World contextual section appears
  await openNavigation();
  const activeWorldNav = page.getByRole('navigation', { name: `World ativo: ${worldName}` });
  await expect(activeWorldNav).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Visão do World', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Wiki', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Diário', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Recursos externos', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Cartografia', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Relações', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Bestiário', exact: true })).toBeVisible();
  await expect(activeWorldNav.getByRole('link', { name: 'Portal do jogador', exact: true })).toBeVisible();

  // ── 3: Deep links ──
  await page.goto('/app/campaigns');
  await expect(page.getByRole('heading', { name: 'Planejador de mesas' })).toBeVisible({ timeout: 30_000 });

  await page.goto('/app/vault');
  await expect(page.getByRole('heading', { name: 'Seu acervo de jogo' })).toBeVisible({ timeout: 30_000 });

  await page.goto('/app/worlds');
  await expect(page.getByRole('heading', { name: 'Seus mundos' })).toBeVisible({ timeout: 30_000 });

  // ── 4: Theme switch doesn't alter navigation ──
  await openNavigation();
  await assertSectionsAndLinksNoWorld();
  await page.getByRole('navigation', { name: 'Sistema' }).getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('radio', { name: /Claro/u }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await openNavigation();
  await assertSectionsAndLinksNoWorld();
  await assertWorldModulesNotVisible();
});
