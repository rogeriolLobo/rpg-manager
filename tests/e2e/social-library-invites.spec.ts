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
  // Auditoria final (2026-08-21): try/finally — mesmo achado real de vazamento de context já
  // corrigido em vtt-live.spec.ts/vtt-realtime.spec.ts/player-view.spec.ts/social-friends.spec.ts.
  try {
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
  } finally {
    await friendContext.close();
  }
});

test("Convite de amigo para Grupo: só amigo aparece na lista, precisa aceitar para virar membro", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-invite-owner-${suffix}@example.com`;
  const friendEmail = `e2e-invite-friend-${suffix}@example.com`;
  await register(page, ownerEmail, `Dono Convite ${suffix}`);

  const friendContext = await browser.newContext();
  try {
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
  } finally {
    await friendContext.close();
  }
});

// Seção 11 do pedido de finalização: fecha a jornada social completa que ainda faltava por
// cima das duas acima (biblioteca compartilhada, convite de Grupo) — convite de CAMPAIGN (não
// Grupo) até aparecer em Minhas Mesas, e a prova de que bloquear impede um NOVO convite (não só
// um novo pedido de amizade, já coberto em social-friends.spec.ts).
test("Convite de amigo para Campaign: aparece em Minhas Mesas; bloquear remove a amizade e impede novo convite", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-campaign-invite-owner-${suffix}@example.com`;
  const friendEmail = `e2e-campaign-invite-friend-${suffix}@example.com`;
  await register(page, ownerEmail, `Dono Campanha ${suffix}`);

  const friendContext = await browser.newContext();
  try {
    const friendPage = await friendContext.newPage();
    await register(friendPage, friendEmail, `Amigo Campanha ${suffix}`);

    await openNav(page);
    await page.getByRole("link", { name: "Amigos" }).click();
    await page.getByLabel(/Buscar pessoas/u).fill(friendEmail);
    await page.getByRole("button", { name: "Buscar" }).click();
    await page.getByRole("listitem").filter({ hasText: `Amigo Campanha ${suffix}` }).getByRole("button", { name: "Adicionar" }).click();
    await openNav(friendPage);
    await friendPage.getByRole("link", { name: "Amigos" }).click();
    await friendPage.getByRole("listitem").filter({ hasText: `Dono Campanha ${suffix}` }).getByRole("button", { name: "Aceitar" }).click();

    await page.goto("/app/library/new");
    await page.getByLabel("Título", { exact: true }).fill(`RPG Convite Campanha ${suffix}`);
    await page.getByLabel("Categoria").selectOption("fantasia");
    await page.getByLabel("Subgênero").selectOption("alta-fantasia");
    await page.getByRole("button", { name: "Salvar RPG" }).click();
    await expect(page.getByRole("heading", { name: `RPG Convite Campanha ${suffix}` })).toBeVisible();
    await page.getByRole("link", { name: "Criar campanha" }).click();
    // Espera a lista de RPGs assentar antes de confirmar a pré-seleção via query param (?rpgId=) —
    // mesmo cuidado de vault-worlds-flow.spec.ts com corridas de fetch assíncrono.
    await expect(page.getByLabel("RPG")).toHaveValue(/.+/u);
    await page.getByLabel("Nome da campanha").fill(`Mesa Convite Campanha ${suffix}`);
    await page.getByRole("button", { name: "Salvar campanha" }).click();
    await expect(page.getByRole("heading", { name: `Mesa Convite Campanha ${suffix}` })).toBeVisible({ timeout: 15_000 });

    // Convite de Campaign (role padrão "Jogador") pelo mesmo painel "Convidar amigo" já usado
    // para Grupo — targetType diferente, mesmo componente (InviteFriendPanel).
    await page.getByRole("heading", { name: "Convidar amigo" }).waitFor();
    await page.getByLabel("Amigo").selectOption({ label: `Amigo Campanha ${suffix}` });
    await page.getByRole("button", { name: "Convidar" }).click();
    await expect(page.getByText("Convite enviado.")).toBeVisible();

    await friendPage.reload();
    await expect(friendPage.getByRole("heading", { name: /Convites de Grupo\/Campanha/u })).toBeVisible();
    await friendPage.getByRole("listitem").filter({ hasText: `Dono Campanha ${suffix}` }).getByRole("button", { name: "Aceitar" }).click();

    // Aparece em Minhas Mesas — o jogador descobre a campanha sem link do mestre.
    await openNav(friendPage);
    await friendPage.getByRole("link", { name: "Minhas Mesas" }).click();
    await expect(friendPage.getByRole("heading", { name: `Mesa Convite Campanha ${suffix}` })).toBeVisible();

    // Bloquear: amizade some, e o amigo bloqueado nem aparece mais no seletor de "Convidar amigo"
    // (InviteFriendPanel só lista /social/friends) — novo convite fica estruturalmente impedido,
    // não só rejeitado depois pelo servidor.
    await openNav(page);
    await page.getByRole("link", { name: "Amigos" }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("listitem").filter({ hasText: `Amigo Campanha ${suffix}` }).getByRole("button", { name: "Bloquear" }).click();
    await expect(page.getByRole("heading", { name: /Amigos \(0\)/u })).toBeVisible();

    await page.goto(`/app/campaigns`);
    await page.getByRole("heading", { name: `Mesa Convite Campanha ${suffix}`, level: 2 }).click();
    // Sem amigos, o painel inteiro de convite não renderiza (ver InviteFriendPanel: retorna null
    // quando a lista de amigos está vazia) — a única forma de "impedir" que é genuinamente
    // impossível de contornar pela UI, mais forte que só um botão desabilitado.
    await expect(page.getByRole("heading", { name: "Convidar amigo" })).toHaveCount(0);
  } finally {
    await friendContext.close();
  }
});
