import { expect as baseExpect, test, type Page } from "@playwright/test";

test.describe("Journal (User-First Architecture)", () => {
  test.setTimeout(240_000);
  const expect = baseExpect.configure({ timeout: 30_000 });
  let email: string;
  let page: Page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    email = `e2e-journal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}@example.com`;
    await page.goto("/register");
    await page.getByLabel("Como quer ser chamado?").fill("Journal User");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
    await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
    await page.getByRole("button", { name: "Criar conta" }).click();
    await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
    await page.getByRole("link", { name: "Já guardei, continuar" }).click();
    await expect(page).toHaveURL(/\/app$/u);
  });

  test("CREATE_WITHOUT_WORLD & FOLDER_WITHOUT_WORLD", async () => {
    await page.goto("/app/journal");
    await expect(page.getByRole("heading", { name: "Diário vazio" })).toBeVisible();

    // Cria página sem world
    await page.getByRole("button", { name: "Criar primeira página" }).click();
    await page.getByLabel("Título", { exact: true }).fill("Global Page");
    await page.getByLabel("Conteúdo", { exact: true }).fill("This is a global page.");
    await page.getByRole("button", { name: "Salvar página" }).click();
    await expect(page.getByRole("button", { name: "Global Page" })).toBeVisible();

    // Cria pasta sem world
    await page.getByLabel("Nova pasta").fill("Global Folder");
    await page.getByRole("button", { name: "Criar" }).click();
    await expect(page.locator(".journal-navigation").getByText("Global Folder", { exact: true })).toBeVisible();

    await page.goto('/app/journal');
    await expect(page.getByRole('heading', { name: 'Global Page', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Diário vazio' })).toHaveCount(0);
  });

  test("LINK_WORLD, LINK_TWO_WORLDS, UNLINK_WORLD_PRESERVES_PAGE", async () => {
    // Precisamos criar dois worlds primeiro
    await page.goto("/app/library/new");
    await page.getByLabel("Título", { exact: true }).fill("RPG Base");
    await page.getByRole("button", { name: "Salvar RPG" }).click();

    await page.goto("/app/worlds/new");
    await page.getByLabel("Nome").fill("World Alpha");
    await page.getByLabel("RPG padrão").selectOption({ label: "RPG Base" });
    await page.getByRole("button", { name: "Salvar World" }).click();
    await expect(page.getByRole("heading", { name: "World Alpha" })).toBeVisible();

    await page.goto("/app/worlds/new");
    await page.getByLabel("Nome").fill("World Beta");
    await page.getByLabel("RPG padrão").selectOption({ label: "RPG Base" });
    await page.getByRole("button", { name: "Salvar World" }).click();
    await expect(page.getByRole("heading", { name: "World Beta" })).toBeVisible();

    // Quick Idea cria a página e o primeiro vínculo.
    await page.goto("/app");
    await page.getByRole("button", { name: "Nova ideia" }).click();
    await page.getByRole("combobox", { name: "Vincular a um World (opcional)" }).selectOption({ label: "World Alpha" });
    await page.getByLabel("Título", { exact: true }).fill("Shared Page");
    await page.getByRole("button", { name: "Salvar ideia" }).click();
    await expect(page.getByText("Ideia salva no Diário.")).toBeVisible();

    // A UI usa o endpoint N:N para criar o segundo vínculo.
    await page.getByRole("link", { name: "Ver no Diário" }).click();
    await expect(page.getByRole("heading", { name: "Shared Page", exact: true })).toBeVisible();
    await page.getByLabel("World Beta", { exact: true }).check();
    await expect(page.getByLabel("World Alpha", { exact: true })).toBeChecked();
    await expect(page.getByLabel("World Beta", { exact: true })).toBeChecked();

    // Desvincular um contexto não apaga a página owned pelo usuário.
    await page.getByLabel("World Alpha", { exact: true }).uncheck();
    await page.goto("/app/journal");
    await expect(page.getByRole("button", { name: "Shared Page" })).toBeVisible();
    await page.getByRole("button", { name: "Shared Page" }).click();
    await expect(page.getByLabel("World Alpha", { exact: true })).not.toBeChecked();
    await expect(page.getByLabel("World Beta", { exact: true })).toBeChecked();

    if ((page.viewportSize()?.width ?? 1000) <= 850) {
      await page.getByRole('button', { name: 'Abrir menu' }).click();
    }
    await page.getByRole('button', { name: 'Abrir paleta de comandos' }).click();
    const palette = page.getByRole('dialog', { name: 'Busca global e comandos' });
    const scope = palette.getByRole('button', { name: /Escopo:/u });
    if (await scope.isVisible()) await scope.click();
    await palette.getByRole('textbox').fill('Shared Page');
    await palette.getByRole('button', { name: /Shared Page/u }).click();
    await expect(page).toHaveURL(/\/app\/journal\?page=[^&]+$/u);
  });

  test("REVISION_HISTORY", async () => {
    await page.goto("/app/journal");
    await page.getByRole("button", { name: "Criar primeira página" }).click();
    await page.getByLabel("Título", { exact: true }).fill("História Antiga");
    await page.getByRole("button", { name: "Salvar página" }).click();
    await expect(page.getByRole("button", { name: /História Antiga/u })).toBeVisible();

    await page.getByLabel("Título", { exact: true }).fill("História Nova");
    await page.getByLabel("Conteúdo", { exact: true }).fill("A nova versão.");
    await page.getByRole("button", { name: "Salvar página" }).click();
    await expect(page.getByRole("button", { name: /História Nova/u })).toBeVisible();

    await page.getByRole("button", { name: "Histórico" }).click();
    await expect(page.getByText("Edição", { exact: true })).toHaveCount(2);
    await page.getByRole("button", { name: "Ver", exact: true }).nth(1).click();
    await expect(page.getByRole("heading", { name: "História Antiga" })).toBeVisible();
    page.once('dialog', async (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Restaurar", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "História Antiga" })).toBeVisible();
  });
});
