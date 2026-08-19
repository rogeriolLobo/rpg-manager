import { expect, test, type Page } from "@playwright/test";

// F-017/F-018 (BATCH8): Biblioteca social e convite de amigo para Grupo. Ver
// src/server/routes/social.ts.
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

test("Biblioteca social: opt-in liga/desliga, amigo vê só depois, interesse social separado do campo pessoal", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-lib-owner-${suffix}@example.com`;
  const friendEmail = `e2e-lib-friend-${suffix}@example.com`;
  await register(page, ownerEmail, `Dono Lib ${suffix}`);

  const friendContext = await browser.newContext();
  const friendPage = await friendContext.newPage();
  await register(friendPage, friendEmail, `Amigo Lib ${suffix}`);

  // Amizade: dono envia pedido pelo e-mail exato, amigo aceita.
  await openNav(page);
  await page.getByRole("link", { name: "Amigos" }).click();
  await page.getByLabel(/Buscar pessoas/u).fill(friendEmail);
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("listitem").filter({ hasText: `Amigo Lib ${suffix}` }).getByRole("button", { name: "Adicionar" }).click();
  await openNav(friendPage);
  await friendPage.getByRole("link", { name: "Amigos" }).click();
  await friendPage.getByRole("listitem").filter({ hasText: `Dono Lib ${suffix}` }).getByRole("button", { name: "Aceitar" }).click();

  // Cadastra um RPG.
  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`${suffix} RPG Social`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `${suffix} RPG Social` })).toBeVisible();

  // Marca interesse social (separado do campo pessoal "Quero jogar" do formulário de edição).
  await page.getByRole("button", { name: "Marcar interesse social" }).click();
  await expect(page.getByRole("button", { name: "Interesse social marcado" })).toBeVisible();

  // Sem opt-in ainda — amigo não consegue ver.
  await openNav(friendPage);
  await friendPage.getByRole("link", { name: "Amigos" }).click();
  await friendPage.getByRole("link", { name: "Ver biblioteca" }).click();
  await expect(friendPage.getByRole("heading", { name: "Não encontrado" })).toBeVisible();

  // Liga o opt-in em Configurações.
  await openNav(page);
  await page.getByRole("link", { name: "Configurações" }).click();
  await page.getByLabel("Compartilhar minha Biblioteca com amigos").check();

  await openNav(friendPage);
  await friendPage.getByRole("link", { name: "Amigos" }).click();
  await friendPage.getByRole("link", { name: "Ver biblioteca" }).click();
  await expect(friendPage.getByRole("heading", { name: `Biblioteca de Dono Lib ${suffix}` })).toBeVisible();
  await expect(friendPage.getByText(`${suffix} RPG Social`)).toBeVisible();
  await expect(friendPage.getByText("Interesse social")).toBeVisible();

  await friendContext.close();
});

test("Convite de amigo para Grupo: só amigo aparece na lista, precisa aceitar para virar membro", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-invite-owner-${suffix}@example.com`;
  const friendEmail = `e2e-invite-friend-${suffix}@example.com`;
  await register(page, ownerEmail, `Dono Convite ${suffix}`);

  const friendContext = await browser.newContext();
  const friendPage = await friendContext.newPage();
  await register(friendPage, friendEmail, `Amigo Convite ${suffix}`);

  await openNav(page);
  await page.getByRole("link", { name: "Amigos" }).click();
  await page.getByLabel(/Buscar pessoas/u).fill(friendEmail);
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("listitem").filter({ hasText: `Amigo Convite ${suffix}` }).getByRole("button", { name: "Adicionar" }).click();
  await openNav(friendPage);
  await friendPage.getByRole("link", { name: "Amigos" }).click();
  await friendPage.getByRole("listitem").filter({ hasText: `Dono Convite ${suffix}` }).getByRole("button", { name: "Aceitar" }).click();

  await openNav(page);
  await page.getByRole("link", { name: "Grupos" }).click();
  await page.getByRole("link", { name: "Novo grupo" }).click();
  await page.getByLabel("Nome do grupo").fill(`Mesa Convite ${suffix}`);
  await page.getByRole("button", { name: "Salvar grupo" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Convite ${suffix}` })).toBeVisible();

  await page.getByRole("heading", { name: "Convidar amigo" }).waitFor();
  await page.getByLabel("Amigo").selectOption({ label: `Amigo Convite ${suffix}` });
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByText("Convite enviado.")).toBeVisible();

  // friendPage já estava em /app/friends desde o passo de aceitar amizade — precisa
  // recarregar para buscar o convite recém-criado (clicar no link da rota atual é um no-op).
  await friendPage.reload();
  await expect(friendPage.getByRole("heading", { name: /Convites de Grupo\/Campanha/u })).toBeVisible();
  await friendPage.getByRole("listitem").filter({ hasText: `Dono Convite ${suffix}` }).getByRole("button", { name: "Aceitar" }).click();

  await openNav(page);
  await page.getByRole("link", { name: "Grupos" }).click();
  await page.getByRole("link", { name: `Mesa Convite ${suffix}` }).click();
  // Locator específico do campo de nome no editor de membro — evita casar com a <option>
  // (invisível) do dropdown "Convidar amigo" que também contém o mesmo texto.
  await expect(page.getByLabel(`Nome de Amigo Convite ${suffix}`)).toBeVisible();
  await expect(page.getByText("Conta cadastrada", { exact: true })).toBeVisible();

  await friendContext.close();
});
