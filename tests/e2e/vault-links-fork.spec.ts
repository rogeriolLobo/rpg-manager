import { expect, test, type Page } from "@playwright/test";

// F-022 (BATCH12): Vault avançado — LINK cross-World e FORK explícito — ver
// src/server/routes/vault.ts.
async function register(page: Page, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

const isMobileViewport = (page: Page) => (page.viewportSize()?.width ?? 1000) <= 850;
const openNav = async (page: Page) => { if (isMobileViewport(page)) await page.getByRole("button", { name: "Abrir menu" }).click(); };

test("Vault avançado: vincula entidade a um segundo World, aparece na Wiki dele, desvincula, e duplica (fork)", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  await register(page, `e2e-vault-link-${suffix}@example.com`, `Dono Link ${suffix}`);

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill(`World A ${suffix}`);
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: `World A ${suffix}` })).toBeVisible();

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill(`World B ${suffix}`);
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: `World B ${suffix}` })).toBeVisible();

  await page.goto("/app/vault/new");
  await page.getByLabel("Nome", { exact: true }).fill(`NPC Compartilhado ${suffix}`);
  await page.getByLabel("World").selectOption({ label: `World A ${suffix}` });
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `NPC Compartilhado ${suffix}` })).toBeVisible();
  const entityUrl = page.url();

  await expect(page.getByText("Nenhum World vinculado.")).toBeVisible();
  await page.getByLabel("Vincular a outro World").selectOption({ label: `World B ${suffix}` });
  await page.getByRole("button", { name: "Vincular", exact: true }).click();
  await expect(page.getByRole("link", { name: `World B ${suffix}` })).toBeVisible();

  // A entidade continua pertencendo ao World A (não some do contexto original).
  await expect(page.locator("dd").filter({ hasText: `World A ${suffix}` })).toBeVisible();

  // Aparece na Wiki do World B, mesmo sem ter sido movida para lá.
  await page.goto("/app/worlds");
  await page.getByRole("link", { name: `World B ${suffix}` }).click();
  await openNav(page);
  await page.getByRole("link", { name: "Wiki", exact: true }).click();
  await expect(page.getByText(`NPC Compartilhado ${suffix}`)).toBeVisible();

  // Desvincular: some da Wiki do World B, mas a entidade continua existindo.
  await page.goto(entityUrl);
  await page.getByRole("button", { name: "Desvincular" }).click();
  await expect(page.getByText("Nenhum World vinculado.")).toBeVisible();

  // Duplicar (fork): cria uma entidade nova e independente.
  await page.getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByRole("heading", { name: `NPC Compartilhado ${suffix} (cópia)` })).toBeVisible();
  await expect(page).not.toHaveURL(/\/app\/vault\/new/u);
});
