import { expect, test, type Page } from "@playwright/test";

// LIB-007: bug real encontrado durante LIB-006 — EXISTING_PUBLICATION já era
// aprovável/processável pelo backend desde LIB-003 (ver
// tests/integration/publication-identity.test.ts, teste que já passava antes
// desta tarefa), mas a UI de preview do import CSV nunca marcava essa linha
// como "actionable": checkbox sempre desabilitado, nunca pré-selecionada.
// Reproduzido aqui pela primeira vez via UI real (nenhum teste E2E de import
// CSV existia antes desta tarefa).
async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro Import");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("import CSV: linha EXISTING_PUBLICATION é selecionável e confirma sem duplicar a Publication", async ({ page }) => {
  test.setTimeout(60_000);
  // ISBN próprio deste teste — Publications são catálogo global compartilhado dentro da mesma
  // execução E2E (ver lição de tests/e2e/rpg-archive-restore.spec.ts sobre colisão de ISBN).
  const isbn = "9783000000003";

  // Conta A cria a Publication original.
  await register(page, `e2e-import-owner-${Date.now()}@example.com`);
  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("Old Dragon RPG");
  await page.getByLabel("ISBN (opcional)").fill(isbn);
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "Old Dragon RPG" })).toBeVisible();

  // Conta B (nova, nunca tem esse título) importa um CSV com o MESMO ISBN, grafia diferente.
  await page.context().clearCookies();
  await register(page, `e2e-import-newcomer-${Date.now()}@example.com`);
  await page.goto("/app/settings/import");

  const csv = [
    "Sistema / Jogo,Categoria,Subgênero,Status da Leitura,ISBN",
    `"Old Dragon (outra grafia)",Fantasia,Alta Fantasia,Não iniciado,${isbn}`,
  ].join("\n");
  const catalogSection = page.locator("section").filter({ hasText: "Importar catálogo" });
  await catalogSection.locator('input[name="csv"]').setInputFiles({ name: "catalogo.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await catalogSection.getByRole("button", { name: "Gerar prévia" }).click();

  await expect(catalogSection.getByText("EXISTING_PUBLICATION")).toBeVisible();
  const checkbox = catalogSection.getByLabel("Aprovar linha 2");
  // A linha precisa estar selecionável (não desabilitada) e, por ser um caminho seguro/aditivo
  // como NOVO/ATUALIZACAO, já vir pré-selecionada.
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).toBeChecked();

  await catalogSection.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(catalogSection.getByText("1 novos", { exact: false })).toBeVisible();

  // Sem duplicata: a Biblioteca de B mostra só 1 "Old Dragon" (a Publication foi reaproveitada).
  await page.goto("/app/library");
  await expect(page.getByText("Old Dragon", { exact: false })).toHaveCount(1);
});
