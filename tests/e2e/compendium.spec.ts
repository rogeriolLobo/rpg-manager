import { expect, test } from "@playwright/test";

// F-027 (BATCH14): Compendium — view agregada sobre o Vault existente, sem domínio novo —
// ver src/client/pages/compendium-pages.tsx.
test("Compendium: agrega Criaturas/Itens/Lore do Vault, sem duplicar dado nenhum", async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Dono Compendium ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-compendium-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/vault/new?type=CREATURE");
  await page.getByLabel("Nome", { exact: true }).fill(`Dragão ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Dragão ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.goto("/app/vault/new?type=ITEM");
  await page.getByLabel("Nome", { exact: true }).fill(`Espada ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Espada ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.goto("/app/compendium");
  await expect(page.getByRole("heading", { name: /Criaturas/u })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Dragão ${suffix}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Itens/u })).toBeVisible();
  await expect(page.getByText(`Espada ${suffix}`)).toBeVisible({ timeout: 30_000 });

  // Busca filtra as três seções ao mesmo tempo.
  await page.getByLabel("Buscar no Compendium").fill("Dragão");
  await expect(page.getByText(`Dragão ${suffix}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`Espada ${suffix}`)).not.toBeVisible();

  // Clicar num card leva para a MESMA entidade do Vault (nunca uma cópia).
  await page.getByLabel("Buscar no Compendium").fill("");
  await page.getByText(`Dragão ${suffix}`).click();
  await expect(page).toHaveURL(/\/app\/vault\/[^/]+$/u);
  await expect(page.getByRole("heading", { name: `Dragão ${suffix}` })).toBeVisible({ timeout: 30_000 });
});
