import { expect as baseExpect, test } from "@playwright/test";

test("Dashboard → Nova ideia → salva no Diário, com ou sem World", async ({ page }) => {
  test.setTimeout(240_000);
  const expect = baseExpect.configure({ timeout: 30_000 });
  const email = `e2e-quickidea-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Narrador Ideias");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  // Testa salvamento rápido SEM world
  await page.getByRole("button", { name: "Nova ideia" }).click();
  await expect(page.getByRole("heading", { name: "Nova ideia" })).toBeVisible();
  await page.getByLabel("Título", { exact: true }).fill("Uma masmorra isolada");
  await page.getByLabel("Anotação (opcional)").fill("Teste sem world.");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(page.getByText("Ideia salva no Diário.")).toBeVisible();

  await page.getByRole("link", { name: "Ver no Diário" }).click();
  await expect(page).toHaveURL(/\/journal\?page=/u);
  await expect(page.getByRole("heading", { name: "Uma masmorra isolada", exact: true })).toBeVisible();

  // Opcional: Voltar e criar um World para testar a vinculação
  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("Sistema de Ideias");
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByRole("button", { name: "Salvar RPG" }).click();

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill("Aldeia das Ideias");
  await page.getByLabel("RPG padrão").selectOption({ label: "Sistema de Ideias" });
  await page.getByRole("button", { name: "Salvar World" }).click();

  await page.goto("/app");
  await page.getByRole("button", { name: "Nova ideia" }).click();
  await page.getByRole("combobox", { name: "Vincular a um World (opcional)", exact: true }).selectOption({ label: "Aldeia das Ideias" });
  await page.getByLabel("Título", { exact: true }).fill("Uma masmorra vinculada");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(page.getByText("Ideia salva no Diário.")).toBeVisible();

  await page.getByRole("link", { name: "Ver no Diário" }).click();
  await expect(page).toHaveURL(/worldId=/);
  await expect(page.getByRole("heading", { name: "Uma masmorra vinculada", exact: true })).toBeVisible();
});
