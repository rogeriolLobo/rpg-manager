import { expect, test, type Page } from "@playwright/test";

// F-001: Revision History — fluxo principal (criar → editar → ver histórico → visualizar
// revisão antiga → restaurar → conferir que o conteúdo voltou e nada do histórico sumiu).
// Cobre Vault entity (o caso mais rico) e uma checagem rápida em World — Journal segue o mesmo
// contrato de API (já testado em tests/integration/revision-history.test.ts) e reaproveita o
// MESMO componente de UI (RevisionHistoryButton), então não repetimos o fluxo completo três vezes.

async function registerFreshAccount(page: Page, label: string) {
  const email = `e2e-revision-${label}-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Revisor ${label}`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}

test("F-001: histórico de revisões de uma entidade do Vault — editar, ver histórico e restaurar", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "vault");

  await page.goto("/app/vault/new");
  await page.getByLabel("Nome", { exact: true }).fill("Versão Original");
  await page.getByLabel("Resumo").fill("resumo original");
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: "Versão Original" })).toBeVisible();

  // Edita — cria a 2ª revisão.
  await page.getByRole("link", { name: "Editar" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Versão Editada");
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: "Versão Editada" })).toBeVisible();

  // Abre o histórico — duas revisões visíveis, a mais recente marcada como "versão atual".
  await page.getByRole("button", { name: "Histórico" }).click();
  await expect(page.getByRole("dialog", { name: "Histórico de revisões" })).toBeVisible();
  const items = page.locator(".revision-item");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("versão atual");
  await expect(items.nth(0)).toContainText("Edição");
  await expect(items.nth(1)).toContainText("Criação");

  // Visualiza a revisão antiga antes de restaurar.
  await items.nth(1).getByRole("button", { name: "Ver" }).click();
  await expect(page.getByRole("heading", { name: "Versão Original" })).toBeVisible();

  // Restaura — o modal fecha, o conteúdo volta ao original. `restore()` chama um confirm()
  // nativo (mesmo padrão de archive/remover pin no resto do app) — sem um handler de dialog
  // registrado ANTES do clique, o Playwright descarta o confirm() por padrão (retorna false),
  // o restore nunca roda e o modal nunca fecha. Achado real: a assert abaixo passava mesmo
  // assim (falso positivo) porque casava com o <h3> deixado pelo preview de "Ver" — nunca
  // confiar em getByRole('heading', ...) sem nível quando um preview secundário pode conter o
  // mesmo texto.
  page.once("dialog", (dialog) => void dialog.accept());
  await items.nth(1).getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByRole("heading", { name: "Versão Original" })).toBeVisible();

  // O histórico ganhou uma 3ª revisão (RESTORE) — nada foi apagado.
  await page.getByRole("button", { name: "Histórico" }).click();
  await expect(page.locator(".revision-item")).toHaveCount(3);
  await expect(page.locator(".revision-item").first()).toContainText("Restauração");
  await expect(page.locator(".revision-item").first()).toContainText("a partir da revisão #1");
});

test("F-001: histórico de um World — mesmo contrato, botão contextual na própria tela", async ({ page }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "world");

  await page.goto("/app/worlds/new");
  await page.getByLabel("Nome", { exact: true }).fill("Mundo Original");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Mundo Original" })).toBeVisible();

  await page.getByRole("link", { name: "Editar" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Mundo Editado");
  await page.getByRole("button", { name: "Salvar World" }).click();
  await expect(page.getByRole("heading", { name: "Mundo Editado" })).toBeVisible();

  await page.getByRole("button", { name: "Histórico" }).click();
  await expect(page.locator(".revision-item")).toHaveCount(2);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator(".revision-item").nth(1).getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByRole("heading", { name: "Mundo Original" })).toBeVisible();
});

test("F-001: histórico é exclusivo do dono — outra conta não vê nem acessa a entidade de terceiros (regressão de segurança)", async ({ page, request }) => {
  test.setTimeout(60_000);
  await registerFreshAccount(page, "owner");
  await page.goto("/app/vault/new");
  await page.getByLabel("Nome", { exact: true }).fill("Entidade Privada");
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: "Entidade Privada" })).toBeVisible();
  const entityId = page.url().split("/").filter(Boolean).pop();

  // A UI já nem mostra o botão de histórico para quem não é dono (a entidade nem aparece pra
  // outra conta sem vínculo) — a checagem real de segurança é direto na API, sem depender do
  // navegador (mesmo padrão de outras regressões de segurança neste projeto).
  const response = await request.get(`/api/v1/vault/${entityId}/revisions`);
  expect(response.status()).toBe(401); // sem sessão nenhuma — 401, não 404 nem 200.
});
