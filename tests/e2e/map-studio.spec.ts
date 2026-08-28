import { expect, test, type Page } from '@playwright/test';

async function registerAndCreateMap(page: Page, name: string, withBackground = false) {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.goto('/register');
  await page.getByLabel('Como quer ser chamado?').fill('Map Studio E2E');
  await page.getByLabel('E-mail').fill(`map-studio-${stamp}@example.com`);
  await page.getByLabel('Senha mínimo de 12 caracteres').fill('uma senha longa map studio 2026');
  await page.getByLabel('Confirmar senha').fill('uma senha longa map studio 2026');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Guarde seus códigos' })).toBeVisible();
  await page.getByRole('link', { name: 'Já guardei, continuar' }).click();
  await page.goto('/app/maps');
  await page.getByLabel('Nome').fill(name);
  if (withBackground) {
    await page.locator('input[type="file"][accept*="image/png"]').first().setInputFiles({
      name: 'map-studio-background.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    });
  }
  await page.getByRole('button', { name: 'Criar mapa' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('Map Studio usa workspace dedicado e preserva edição, autosave e atalhos', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Cobertura desktop do workspace');
  await registerAndCreateMap(page, 'Mapa One-Shot', true);

  const viewport = page.viewportSize()!;
  const workspace = page.getByRole('region', { name: 'Editor do mapa' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('.app-shell, .sidebar, .mobile-header')).toHaveCount(0);
  const workspaceBox = await workspace.boundingBox();
  expect(workspaceBox).not.toBeNull();
  expect(Math.abs(workspaceBox!.width - viewport.width)).toBeLessThan(2);
  expect(Math.abs(workspaceBox!.height - viewport.height)).toBeLessThan(2);

  await expect(page.getByRole('navigation', { name: 'Ferramentas do mapa' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Painel de camadas' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector do mapa' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] image')).toHaveCount(1);

  // ToolPanel abre/fecha sem desmontar o canvas.
  await page.getByRole('button', { name: 'Fechar painel de camadas' }).click();
  await expect(page.getByRole('complementary', { name: 'Painel de camadas' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Canvas do mapa' })).toBeVisible();
  await page.getByRole('button', { name: 'Camadas', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Painel de camadas' })).toBeVisible();

  // World é contexto opcional dentro de Settings, nunca conteúdo do canvas.
  await expect(page.getByText('Worlds opcionais')).toBeVisible();
  await expect(page.getByLabel('Área de criação do mapa').getByText('Worlds opcionais')).toHaveCount(0);
  await page.getByText('Worlds opcionais').click();
  await expect(page.getByText('Nenhum World disponível. O mapa continua utilizável.')).toBeVisible();

  // Tab dentro de input preserva navegação; fora de campos alterna o Modo Foco.
  const nameInput = page.getByLabel('Nome', { exact: true });
  await nameInput.focus();
  await page.keyboard.press('Tab');
  await expect(workspace).toHaveAttribute('data-focus-mode', 'false');
  await expect(page.getByLabel('Descrição', { exact: true })).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(workspace).toHaveAttribute('data-focus-mode', 'true');
  await expect(page.getByRole('complementary', { name: 'Painel de camadas' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Inspector do mapa' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(workspace).toHaveAttribute('data-focus-mode', 'false');
  await expect(page.getByRole('complementary', { name: 'Painel de camadas' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Inspector do mapa' })).toBeVisible();
  await page.getByRole('button', { name: 'Modo Foco' }).click();
  await expect(workspace).toHaveAttribute('data-focus-mode', 'true');
  await page.getByRole('button', { name: 'Modo Foco' }).click();

  // Shapes, Inspector contextual, undo/redo e autosave continuam funcionais.
  await page.getByRole('button', { name: 'Retângulo' }).click();
  await expect(page.getByRole('heading', { name: 'Seleção' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);
  await expect(page.getByLabel('Status do mapa').getByText('Alterações pendentes')).toBeVisible();
  await expect(page.getByLabel('Status do mapa').getByText('Salvo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Refazer' }).click();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Elipse' }).click();
  await page.getByRole('button', { name: 'Texto' }).click();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] ellipse')).toHaveCount(1);
  await expect(page.locator('svg[aria-label="Canvas do mapa"] text')).toHaveCount(1);

  // Layers mantém add, rename, visibility, lock e reorder.
  await page.getByRole('button', { name: '+ Nova camada' }).click();
  const layerNames = page.locator('.map-layer-name');
  await expect(layerNames).toHaveCount(2);
  await layerNames.first().fill('Anotações');
  await layerNames.first().blur();
  await expect(page.getByLabel('Renomear camada Anotações')).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar Anotações' }).click();
  await expect(page.getByRole('button', { name: 'Mostrar Anotações' })).toBeVisible();
  await page.getByRole('button', { name: 'Bloquear Anotações' }).click();
  await expect(page.getByRole('button', { name: 'Desbloquear Anotações' })).toBeVisible();

  // Zoom e pan alteram somente a viewport, sem perder o documento.
  const canvas = page.getByRole('img', { name: 'Canvas do mapa' });
  const initialViewBox = await canvas.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Aumentar zoom' }).click();
  await expect(canvas).not.toHaveAttribute('viewBox', initialViewBox!);
  const zoomedViewBox = await canvas.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Mover tela' }).click();
  const canvasBox = await canvas.boundingBox();
  await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + canvasBox!.width / 2 + 45, canvasBox!.y + canvasBox!.height / 2 + 25);
  await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('viewBox', zoomedViewBox!);

  // Metadados salvam dentro do Inspector e o documento persiste após reload.
  await page.getByRole('button', { name: 'Configurações do mapa' }).click();
  await nameInput.fill('Mapa Workspace');
  await page.getByRole('button', { name: 'Salvar detalhes' }).click();
  await expect(page.getByRole('heading', { name: 'Mapa Workspace' })).toBeVisible();
  await expect(page.getByLabel('Status do mapa').getByText('Salvo', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mapa Workspace' })).toBeVisible();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);
  await expect(page.locator('svg[aria-label="Canvas do mapa"] ellipse')).toHaveCount(1);
  await expect(page.locator('svg[aria-label="Canvas do mapa"] text')).toHaveCount(1);
});

test('Map Studio permanece utilizável em viewport mobile', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Cobertura responsiva mobile');
  await registerAndCreateMap(page, 'Mapa Mobile');
  const workspace = page.getByRole('region', { name: 'Editor do mapa' });
  await expect(workspace).toBeVisible();
  await expect(page.locator('.app-shell, .sidebar')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Ferramentas do mapa' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Painel de camadas' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Inspector do mapa' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Camadas', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar painel de camadas' }).click();
  await page.getByRole('button', { name: 'Configurações do mapa' }).click();
  await page.getByRole('button', { name: 'Fechar inspector' }).click();
  const canvas = page.getByRole('img', { name: 'Canvas do mapa' });
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(250);
  expect(box!.height).toBeGreaterThan(400);
  await page.getByRole('button', { name: 'Retângulo' }).click();
  await expect(page.locator('svg[aria-label="Canvas do mapa"] rect[fill="#8b5e3c"]')).toHaveCount(1);
  await expect(page.getByLabel('Status do mapa').getByText('Salvo', { exact: true })).toBeVisible();
});
