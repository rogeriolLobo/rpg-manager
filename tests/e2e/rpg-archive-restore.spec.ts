import { expect, test, type Page } from "@playwright/test";

// LIB-006: archivar/restaurar um RPG pela UI real — Biblioteca (Ativos/Arquivados),
// detalhe do RPG, e a busca reconhecendo uma Publication já arquivada (sem duplicar).
async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro Arquivo");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("Biblioteca → arquivar RPG → some dos ativos → aparece em Arquivados → restaurar → volta aos ativos", async ({ page }) => {
  test.setTimeout(60_000);
  await register(page, `e2e-archive-${Date.now()}@example.com`);

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("RPG Para Arquivar");
  await page.getByLabel("URL da capa (opcional)").fill("https://exemplo.com/capa-arquivo.jpg");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Para Arquivar" })).toBeVisible();

  // Arquivar (confirma o diálogo nativo).
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Arquivar RPG" }).click();
  await expect(page.getByRole("button", { name: "Restaurar RPG" })).toBeVisible();

  // Some da Biblioteca ativa.
  await page.goto("/app/library");
  await expect(page.getByRole("heading", { name: "RPG Para Arquivar" })).toHaveCount(0);
  await expect(page.getByText("RPG Para Arquivar")).toHaveCount(0);

  // Aparece em Arquivados.
  await page.getByRole("tab", { name: "Arquivados" }).click();
  await expect(page.getByText("RPG Para Arquivar")).toBeVisible();
  await page.getByText("RPG Para Arquivar").click();

  // Restaurar — volta para a Biblioteca ativa com a capa intacta (checado via o campo do
  // formulário, não via carregamento real da imagem — mesmo padrão de rpg-cover-edit.spec.ts,
  // independente de rede/CDN externa).
  await expect(page.getByRole("heading", { name: "RPG Para Arquivar" })).toBeVisible();
  await page.getByRole("button", { name: "Restaurar RPG" }).click();
  await expect(page.getByRole("button", { name: "Arquivar RPG" })).toBeVisible();
  await page.getByRole("link", { name: "Editar" }).click();
  await expect(page.getByLabel("URL da capa (opcional)")).toHaveValue("https://exemplo.com/capa-arquivo.jpg");

  await page.goto("/app/library");
  await expect(page.getByText("RPG Para Arquivar")).toBeVisible();
  await page.getByRole("tab", { name: "Arquivados" }).click();
  await expect(page.getByText("RPG Para Arquivar")).toHaveCount(0);
});

test("buscar uma Publication já arquivada mostra 'Arquivado na sua Biblioteca' e Restaurar não duplica", async ({ page }) => {
  test.setTimeout(60_000);
  await register(page, `e2e-archive-search-${Date.now()}@example.com`);

  // ISBN próprio deste teste (não o "9783161484100" usado pela fixture determinística de
  // rpg-online-search.spec.ts) — Publications são um catálogo global compartilhado entre TODOS
  // os arquivos E2E na mesma execução; reaproveitar a mesma identidade colidiria com aquele
  // outro teste (a Publication seria criada aqui, sem os dados de Open Library que ele espera).
  const title = "RPG Buscável Arquivado";
  const isbn = "9782999000018";
  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(title);
  await page.getByLabel("ISBN (opcional)").fill(isbn);
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Arquivar RPG" }).click();
  await expect(page.getByRole("button", { name: "Restaurar RPG" })).toBeVisible();

  // Agora o ISBN já é uma Library Entry arquivada do usuário: a busca externa real (ISBN) é a
  // que enxerga isso (não a fixture de texto livre), então buscamos direto pelo ISBN.
  await page.goto("/app/library/new");
  await page.getByRole("button", { name: "Buscar online" }).click();
  await page.getByLabel("Buscar livro por título, ISBN ou autor").fill(isbn);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Arquivado na sua Biblioteca")).toBeVisible();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(page).toHaveURL(/\/app\/library\/[^/]+$/u);
  await expect(page.getByRole("button", { name: "Arquivar RPG" })).toBeVisible();

  // Sem duplicata: só um "RPG Buscável Arquivado" na Biblioteca ativa.
  await page.goto("/app/library");
  await expect(page.getByText(title)).toHaveCount(1);
});
