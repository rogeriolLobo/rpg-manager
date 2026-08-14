import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function updateLocalCoverUrl(rpgId: string, coverUrl: string) {
  const sql = `UPDATE rpgs SET cover_url='${coverUrl}' WHERE id='${rpgId}';`;
  execSync(`npx wrangler d1 execute DB --local --command "${sql.replaceAll('"', '\\"')}"`, { stdio: "pipe" });
}

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

test("DoD RPG_EDIT_INVALID_DATA: capa legada real (devir.com.br) pelo formulário de verdade", async ({ page }) => {
  test.setTimeout(90_000);
  const email = `e2e-devir-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro Devir");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  // RPG "legado": criado sem capa, depois recebe via D1 uma capa real fora da allowlist
  // atual — exatamente o caso relatado no smoke manual (devir.com.br).
  await page.goto("/app/library/new");
  await page.getByLabel("Título").fill("RPG Legado Devir");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Legado Devir" })).toBeVisible();
  const legacyId = page.url().split("/").filter(Boolean).pop()!;
  const legacyCoverUrl = "https://devir.com.br/wp-content/uploads/2022/08/imagem-destaque-site-1-2-780x654.png";
  updateLocalCoverUrl(legacyId, legacyCoverUrl);

  // RPG com capa JÁ permitida pela política atual.
  await page.goto("/app/library/new");
  await page.getByLabel("Título").fill("RPG Capa Permitida");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Capa Permitida" })).toBeVisible();
  const allowedId = page.url().split("/").filter(Boolean).pop()!;
  const allowedCoverUrl = "https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg";
  updateLocalCoverUrl(allowedId, allowedCoverUrl);

  // DoD 1: capa histórica, abrir Editar, NÃO alterar nada, Salvar → sucesso.
  await page.goto(`/app/library/${legacyId}/edit`);
  await expect(page.getByLabel("URL da capa (opcional)")).toHaveValue(legacyCoverUrl);
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Legado Devir" })).toBeVisible();

  // DoD 2: alterar só "Quero jogar" → sucesso → capa histórica preservada.
  await page.goto(`/app/library/${legacyId}/edit`);
  await page.getByLabel("Quero jogar").check();
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Legado Devir" })).toBeVisible();
  await page.goto(`/app/library/${legacyId}/edit`);
  await expect(page.getByLabel("URL da capa (opcional)")).toHaveValue(legacyCoverUrl);
  await expect(page.getByLabel("Quero jogar")).toBeChecked();

  // DoD 3: trocar para URL NOVA proibida → rejeitar, erro junto ao campo.
  await page.getByLabel("URL da capa (opcional)").fill("https://outro-proibido.example.com/x.jpg");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByText("Revise os campos destacados.")).toBeVisible();
  await expect(page.locator("label", { hasText: "URL da capa" }).locator(".field-error")).toBeVisible();

  // DoD 4: remover a capa → salvar → sucesso, capa removida.
  await page.goto(`/app/library/${legacyId}/edit`);
  await page.getByLabel("URL da capa (opcional)").fill("");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Legado Devir" })).toBeVisible();
  await page.goto(`/app/library/${legacyId}/edit`);
  await expect(page.getByLabel("URL da capa (opcional)")).toHaveValue("");

  // DoD 5: RPG com capa JÁ permitida, editar sem alterar nada → sucesso.
  await page.goto(`/app/library/${allowedId}/edit`);
  await expect(page.getByLabel("URL da capa (opcional)")).toHaveValue(allowedCoverUrl);
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Capa Permitida" })).toBeVisible();
});
