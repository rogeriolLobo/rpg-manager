import { expect, test, type Page } from "@playwright/test";

// LIB-004: busca online (Open Library) — mockada via um seam determinístico
// server-side (query com prefixo "__e2e_fixture__", travado atrás de
// ENVIRONMENT !== production — ver src/server/routes/rpgs.ts). Playwright só
// intercepta requests do NAVEGADOR; a busca é feita pelo servidor
// (docs/library/PUBLICATION_IDENTITY.md — host fixo, nunca vindo do
// cliente), então não há como usar page.route() aqui — nenhuma chamada real
// à Open Library acontece neste arquivo.

async function registerFreshAccount(page: Page, label: string) {
  const email = `e2e-search-${label}-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Buscador ${label}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("busca online: buscar, selecionar, revisar em preview e confirmar cria o RPG com provenance", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "fluxo-completo");

  await page.goto("/app/library/new");
  await page.getByRole("button", { name: "Buscar online" }).click();
  await expect(page.getByRole("heading", { name: "Buscar online" })).toBeVisible();

  await page.getByLabel("Buscar livro por título, ISBN ou autor").fill("__e2e_fixture__ aventuras");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Aventuras de Teste")).toBeVisible();
  await expect(page.getByText("Autora Fixture", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Selecionar" }).click();

  // Preview: mesmo formulário, pré-preenchido, com o aviso de origem — revisável antes de salvar.
  await expect(page.getByText("Dados de: Open Library.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Título")).toHaveValue("Aventuras de Teste");
  await expect(page.getByLabel("ISBN (opcional)")).toHaveValue("9783161484100");

  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "Aventuras de Teste" })).toBeVisible();
  await expect(page.getByText("Autora Fixture")).toBeVisible();
  await expect(page.getByText("Open Library")).toBeVisible();
});

test("busca online: sem resultados mostra mensagem clara, sem travar a tela", async ({ page }) => {
  await registerFreshAccount(page, "sem-resultado");
  await page.goto("/app/library/new");
  await page.getByRole("button", { name: "Buscar online" }).click();
  await page.getByLabel("Buscar livro por título, ISBN ou autor").fill("__e2e_fixture__no-results");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Nenhum resultado para essa busca")).toBeVisible();
  // Cadastro manual continua acessível a partir daqui.
  await page.getByRole("button", { name: "Cadastrar manualmente" }).click();
  await expect(page.getByLabel("Título")).toBeVisible();
});

test("busca online: provider indisponível mostra erro amigável, cadastro manual continua funcionando", async ({ page }) => {
  await registerFreshAccount(page, "provider-off");
  await page.goto("/app/library/new");
  await page.getByRole("button", { name: "Buscar online" }).click();
  await page.getByLabel("Buscar livro por título, ISBN ou autor").fill("__e2e_fixture__provider-error");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText("Não foi possível consultar a Open Library agora")).toBeVisible();

  await page.getByRole("button", { name: "Cadastrar manualmente" }).click();
  await page.getByLabel("Título").fill("RPG Cadastrado na Mão");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Cadastrado na Mão" })).toBeVisible();
});

test("busca online: selecionar o mesmo resultado de novo é rejeitado (ALREADY_IN_LIBRARY)", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "already-in-library");

  const selectAndSave = async () => {
    await page.goto("/app/library/new");
    await page.getByRole("button", { name: "Buscar online" }).click();
    await page.getByLabel("Buscar livro por título, ISBN ou autor").fill("__e2e_fixture__ aventuras");
    await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("button", { name: "Selecionar" }).click();
  };

  await selectAndSave();
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "Aventuras de Teste" })).toBeVisible();

  await selectAndSave();
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByText("Você já tem este título na sua biblioteca.")).toBeVisible();
});

test("cadastro manual continua funcionando sem nenhuma interação com busca online (regressão)", async ({ page }) => {
  await registerFreshAccount(page, "manual-regressao");
  await page.goto("/app/library/new");
  await expect(page.getByLabel("Título")).toBeVisible();
  await page.getByLabel("Título").fill("RPG 100% Manual");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG 100% Manual" })).toBeVisible();
  await expect(page.getByText("Manual")).toBeVisible();
});
