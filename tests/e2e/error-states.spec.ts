import { expect, test, type Page } from "@playwright/test";

// RPG-1.0-BATCH4: nenhuma página pode ficar presa em "Carregando…" para sempre quando o
// load inicial falha (404 de recurso inexistente, 404-por-autorização — o backend nunca
// distingue os dois para não vazar existência, ver Seção 17 do CLAUDE.md — ou sessão
// expirada). TEST FIRST: este spec falha contra o código anterior ao useResource/
// ResourceFallback (src/client/api/use-resource.ts, src/client/components/resource-state.tsx).
async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro Erros");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("404 de recurso inexistente mostra estado amigável, não spinner infinito, e navegação continua", async ({ page }) => {
  test.setTimeout(60_000);
  await register(page, `e2e-error-404-${Date.now()}@example.com`);

  await page.goto("/app/library/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "Não encontrado" })).toBeVisible();
  await expect(page.getByText("Carregando")).toHaveCount(0);

  // Navegação continua funcional depois do erro (não é um estado travado).
  if ((page.viewportSize()?.width ?? 1000) <= 850) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Biblioteca" }).click();
  await expect(page).toHaveURL(/\/app\/library$/u);
});

test("404 por autorização (World privado de outra conta) mostra o mesmo estado amigável, sem vazar existência", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const ownerEmail = `e2e-error-owner-${Date.now()}@example.com`;
  await register(page, ownerEmail);
  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome").fill("Mundo Privado do Dono");
  await page.getByLabel("Descrição").fill("Mundo de teste.");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Mundo Privado do Dono" })).toBeVisible();
  const worldId = new URL(page.url()).pathname.split("/").pop();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await register(outsiderPage, `e2e-error-outsider-${Date.now()}@example.com`);
  await outsiderPage.goto(`/app/worlds/${worldId}/cartography`);
  await expect(outsiderPage.getByRole("heading", { name: "Não encontrado" })).toBeVisible();
  await expect(outsiderPage.getByText("Carregando")).toHaveCount(0);
  await outsiderContext.close();
});

test("sessão expirada durante navegação SPA (sem reload) redireciona para o login em vez de travar", async ({ page, context }) => {
  test.setTimeout(60_000);
  await register(page, `e2e-error-session-${Date.now()}@example.com`);
  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill("RPG Antes da Sessão Expirar");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: "RPG Antes da Sessão Expirar" })).toBeVisible();

  // Simula sessão expirada no servidor (ex.: cookie expirou/foi revogado) sem recarregar
  // a página — o app React continua "logado" na memória até a próxima chamada de API.
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.filter((cookie) => cookie.name !== "rpg_session"));

  // Navegação SPA (clique, não page.goto) — dispara um novo fetch autenticado que agora
  // falha com 401 UNAUTHENTICATED. Sem tratamento, o app não percebe e a página trava.
  if ((page.viewportSize()?.width ?? 1000) <= 850) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Biblioteca" }).click();
  await expect(page).toHaveURL(/\/login$/u, { timeout: 15_000 });
});
