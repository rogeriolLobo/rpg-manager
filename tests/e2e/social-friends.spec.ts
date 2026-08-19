import { expect, test, type Page } from "@playwright/test";

// F-016/F-019 (BATCH7): fluxo real de amizade entre duas contas — busca, pedido, aceite,
// notificação, remoção e bloqueio. Ver src/server/routes/social.ts.
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
const closeNav = async (page: Page) => { if (isMobileViewport(page)) await page.getByRole("button", { name: "Fechar menu" }).click(); };

test("busca → pedido de amizade → aceitar → amigos nos dois lados → notificação → remover amizade", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  const aliceEmail = `e2e-social-alice-${suffix}@example.com`;
  const bobEmail = `e2e-social-bob-${suffix}@example.com`;
  await register(page, aliceEmail, `Alice Social ${suffix}`);

  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await register(bobPage, bobEmail, `Bob Social ${suffix}`);

  await openNav(page);
  await page.getByRole("link", { name: "Amigos" }).click();
  await expect(page.getByRole("heading", { name: "Amigos", exact: true })).toBeVisible();
  await page.getByLabel(/Buscar pessoas/u).fill(bobEmail);
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByText(`Bob Social ${suffix}`)).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: `Bob Social ${suffix}` }).getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: `Bob Social ${suffix}` }).getByText("Pedido enviado")).toBeVisible();

  await openNav(bobPage);
  await bobPage.getByRole("link", { name: "Amigos" }).click();
  await expect(bobPage.getByRole("heading", { name: "Pedidos recebidos" })).toBeVisible();
  await expect(bobPage.getByText(`Alice Social ${suffix}`)).toBeVisible();
  await bobPage.getByRole("listitem").filter({ hasText: `Alice Social ${suffix}` }).getByRole("button", { name: "Aceitar" }).click();
  await expect(bobPage.getByRole("heading", { name: /Amigos \(1\)/u })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: /Amigos \(1\)/u })).toBeVisible();
  await expect(page.getByText(`Bob Social ${suffix}`)).toBeVisible();

  // Notificação de aceite chegou para alice (quem pediu) — reabre o menu mobile, que fecha
  // de novo a cada reload de página inteira.
  await openNav(page);
  await expect(page.getByRole("button", { name: "Notificações (1 não lida)" })).toBeVisible();
  await page.getByRole("button", { name: /Notificações/u }).click();
  await expect(page.getByText("Pedido de amizade aceito")).toBeVisible();
  await closeNav(page);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("listitem").filter({ hasText: `Bob Social ${suffix}` }).getByRole("button", { name: "Remover" }).click();
  await expect(page.getByRole("heading", { name: /Amigos \(0\)/u })).toBeVisible();

  await bobContext.close();
});

test("bloquear impede novo pedido; desbloquear libera de novo", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();
  await register(page, `e2e-social-block-a-${suffix}@example.com`, `Bloqueador ${suffix}`);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const targetEmail = `e2e-social-block-b-${suffix}@example.com`;
  await register(otherPage, targetEmail, `Bloqueado ${suffix}`);

  await openNav(page);
  await page.getByRole("link", { name: "Amigos" }).click();
  await page.getByLabel(/Buscar pessoas/u).fill(targetEmail);
  await page.getByRole("button", { name: "Buscar" }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("listitem").filter({ hasText: `Bloqueado ${suffix}` }).getByRole("button", { name: "Bloquear" }).click();
  await expect(page.getByRole("heading", { name: /Bloqueados \(1\)/u })).toBeVisible();

  await page.getByRole("button", { name: "Desbloquear" }).click();
  await expect(page.getByText(/Bloqueados \(/u)).toHaveCount(0);

  await otherContext.close();
});
