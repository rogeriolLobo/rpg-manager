import { expect, test } from "@playwright/test";

test("edição de RPG: sem alteração salva, sem vazar dados entre RPGs, capa nova proibida é rejeitada no campo", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `e2e-cover-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro Capa");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  // Cria dois RPGs distintos, sem capa, para testar troca de contexto no formulário.
  await page.goto("/app/library/new");
  await page.getByLabel("Título").fill("RPG Alfa Capa");
  await page.getByLabel("Notas").fill("Notas exclusivas do Alfa.");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Alfa Capa" })).toBeVisible();
  const alphaUrl = page.url();

  await page.goto("/app/library/new");
  await page.getByLabel("Título").fill("RPG Beta Capa");
  await page.getByLabel("Notas").fill("Notas exclusivas do Beta.");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Beta Capa" })).toBeVisible();
  const betaUrl = page.url();

  // Abre a edição do Alfa, digita algo sem salvar, e navega DIRETO para a edição do Beta
  // (sem passar por "Novo RPG"): o formulário do Beta não pode mostrar dado do Alfa.
  await page.goto(`${alphaUrl}/edit`);
  await expect(page.getByLabel("Notas")).toHaveValue("Notas exclusivas do Alfa.");
  await page.getByLabel("Notas").fill("Rascunho não salvo do Alfa — não deve vazar.");
  await page.goto(`${betaUrl}/edit`);
  await expect(page.getByLabel("Título")).toHaveValue("RPG Beta Capa");
  await expect(page.getByLabel("Notas")).toHaveValue("Notas exclusivas do Beta.");

  // Editar sem alterar nada precisa funcionar (regressão principal do bug original).
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Beta Capa" })).toBeVisible();

  // Trocar para uma capa nova fora da política atual: deve ser rejeitada com erro no campo.
  await page.goto(`${betaUrl}/edit`);
  await page.getByLabel("URL da capa (opcional)").fill("https://exemplo-nao-autorizado.example.com/x.jpg");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByText("Revise os campos destacados.")).toBeVisible();
  const coverFieldError = page.locator("label", { hasText: "URL da capa" }).locator(".field-error");
  await expect(coverFieldError).toBeVisible();

  // Notas do Beta continuam intactas (o erro de capa não afeta os demais campos).
  await expect(page.getByLabel("Notas")).toHaveValue("Notas exclusivas do Beta.");
});
