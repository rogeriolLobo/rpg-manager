import { expect, test } from "@playwright/test";

// F-026 (BATCH14): Conteúdo oficial/licenciado — proveniência de uma Vault Entity — ver
// src/server/routes/vault.ts.
test("Vault: marca entidade como licenciada com editora/edição, e trava/destrava a descrição", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Dono Proveniência ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-provenance-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/vault/new");
  await page.getByLabel("Nome", { exact: true }).fill(`Lore Oficial ${suffix}`);
  await page.getByLabel("Origem do conteúdo").selectOption("LICENSED");
  await page.getByLabel("Editora").fill("Editora Exemplo");
  await page.getByLabel("Edição", { exact: true }).fill("2ª edição");
  await page.getByLabel("Travar descrição contra edição acidental").check();
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Lore Oficial ${suffix}` })).toBeVisible();
  await expect(page.getByText("Editora Exemplo")).toBeVisible();

  // Editar a descrição com o conteúdo travado é rejeitado pelo servidor.
  await page.getByRole("link", { name: "Editar" }).click();
  await page.getByRole("textbox", { name: "Descrição" }).fill("tentativa de reescrever");
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByText("Destrave o conteúdo antes de alterar a descrição.")).toBeVisible();

  // Destrava e edita na mesma submissão.
  await page.getByLabel("Travar descrição contra edição acidental").uncheck();
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Lore Oficial ${suffix}` })).toBeVisible();
});
