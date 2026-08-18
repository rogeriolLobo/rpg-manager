import { expect, test } from "@playwright/test";

// F-005 (Ideas / Quick Capture): UX rápida sobre o Diário existente, acessível a partir do
// Dashboard — sem domínio novo (ver docs/product/MASTER_BACKLOG.md).
test("Dashboard → Nova ideia → salva no Diário do World escolhido, sem duplicar domínio", async ({ page }) => {
  test.setTimeout(60_000);
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

  // Sem World próprio, o atalho não aparece (não há onde salvar a ideia).
  await expect(page.getByRole("button", { name: "Nova ideia" })).toHaveCount(0);

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("Sistema de Ideias");
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "Sistema de Ideias" })).toBeVisible();

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill("Aldeia das Ideias");
  await page.getByLabel("RPG padrão").selectOption({ label: "Sistema de Ideias" });
  await page.getByLabel("Descrição").fill("Mundo de teste.");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Aldeia das Ideias" })).toBeVisible();

  await page.goto("/app");
  await page.getByRole("button", { name: "Nova ideia" }).click();
  await expect(page.getByRole("heading", { name: "Nova ideia" })).toBeVisible();
  await page.getByLabel("World").selectOption({ label: "Aldeia das Ideias" });
  await page.getByLabel("Título", { exact: true }).fill("Uma masmorra flutuante");
  await page.getByLabel("Anotação (opcional)").fill("Pode ser o gancho da próxima sessão.");
  await page.getByRole("button", { name: "Salvar ideia" }).click();
  await expect(page.getByText("Ideia salva no Diário.")).toBeVisible();

  await page.getByRole("link", { name: "Ver no Diário" }).click();
  await expect(page).toHaveURL(/\/journal$/u);
  await expect(page.getByText("Uma masmorra flutuante")).toBeVisible();
});
