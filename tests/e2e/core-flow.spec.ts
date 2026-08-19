import { expect, test } from "@playwright/test";

test("fluxo completo de cadastro até sessão e dashboard", async ({ page }) => {
  test.setTimeout(60_000);
  const attachThemeScreenshot = async (name: string) => {
    if (test.info().project.name !== "chromium") return;

    await test.info().attach(name, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  };
  const openNavigation = async () => {
    if ((page.viewportSize()?.width ?? 1000) <= 850) {
      await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(page.locator(".sidebar")).toHaveCSS(
        "transform",
        "matrix(1, 0, 0, 1, 0, 0)",
      );
    }
  };
  const email = `e2e-${Date.now()}@example.com`;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await attachThemeScreenshot("login-dark");
  await page.goto("/register");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await attachThemeScreenshot("registro-dark");
  await page.getByLabel("Como quer ser chamado?").fill("Aventureiro E2E");
  await page.getByLabel("E-mail").fill(email);
  await page
    .getByLabel("Senha mínimo de 12 caracteres")
    .fill("uma senha longa para e2e 2026");
  await page
    .getByLabel("Confirmar senha")
    .fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(
    page.getByRole("heading", { name: "Guarde seus códigos" }),
  ).toBeVisible();
  await expect(page.locator(".recovery-codes code")).toHaveCount(10);
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
  await openNavigation();
  await page.getByRole("link", { name: "Configurações" }).click();
  await expect(page.getByRole("radio", { name: /Sistema/u })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: /Escuro/u }).check();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Escuro/u })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await attachThemeScreenshot("configuracoes-dark");
  await page.getByRole("radio", { name: /Claro/u }).check();
  await page.reload();
  await expect(page.getByRole("radio", { name: /Claro/u })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await attachThemeScreenshot("configuracoes-light");
  await page.getByRole("radio", { name: /Sistema/u }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.getByRole("radio", { name: /Sistema/u })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await openNavigation();
  await page.getByRole("link", { name: "Grupos" }).click();
  await page.getByRole("link", { name: "Novo grupo" }).click();
  await page.getByLabel("Nome do grupo").fill("Mesa E2E");
  await page.getByRole("button", { name: "Salvar grupo" }).click();
  await page.getByLabel("Nome público ou e-mail exato").fill(email);
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("button", { name: "Adicionar como narrador" }).click();
  await expect(page.getByText("Aventureiro E2E").first()).toBeVisible();
  await page.getByLabel("Nome do jogador").fill("Marcelo");
  await page.getByRole("button", { name: "Adicionar convidado" }).click();
  await expect(page.getByLabel("Nome de Marcelo")).toBeVisible();
  await openNavigation();
  await page.getByRole("link", { name: "Biblioteca" }).click();
  await page.getByRole("link", { name: "Novo RPG" }).click();
  await page.getByLabel("Título", { exact: true }).fill("Blue Rose E2E");
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByLabel("Status da leitura").selectOption("READ");
  await page.getByLabel("Prioridade").selectOption("HIGH");
  await page.getByLabel("Grupo de jogo").selectOption({ label: "Mesa E2E" });
  await page.getByLabel("Quero jogar").check();
  await page.getByLabel("Grupo / jogadores").fill("Adriana, Marcelo");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(
    page.getByRole("heading", { name: "Blue Rose E2E" }),
  ).toBeVisible();
  await attachThemeScreenshot("biblioteca-light");

  await page.getByRole("link", { name: "Criar campanha" }).click();
  await page.getByLabel("Nome da campanha").fill("A Coroa de E2E");
  await page.getByLabel("Grupo de jogo").selectOption({ label: "Mesa E2E" });
  await expect(page.getByLabel("Narrador")).toHaveValue("Aventureiro E2E");
  // F-024 (BATCH13): One-Shot é um formato explícito de Campaign, padrão "Campanha".
  await expect(page.getByLabel("Formato")).toHaveValue("CAMPAIGN");
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(
    page.getByRole("heading", { name: "A Coroa de E2E" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Mesa E2E", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mesa E2E" })).toBeVisible();
  await page.getByRole("link", { name: "Nova campanha" }).click();
  await expect(page.getByLabel("Grupo de jogo")).toHaveValue(/.+/u);
  await page.goBack();
  await page.getByRole("link", { name: "A Coroa de E2E", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A Coroa de E2E" }),
  ).toBeVisible();
  await expect(page.getByLabel("Jogador Marcelo")).toBeVisible();
  await page.getByLabel("Nome do jogador").fill("Adriana");
  await page.getByLabel("Nome do personagem").fill("Lina");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByLabel("Personagem de Adriana")).toHaveValue("Lina");

  await page.getByRole("link", { name: "Registrar sessão" }).first().click();
  await page.getByLabel("Título", { exact: true }).fill("O chamado");
  await page.getByLabel(/Adriana/).check();
  await page
    .getByLabel("Resumo")
    .fill("O grupo encontrou uma carta misteriosa.");
  await page.getByRole("button", { name: "Salvar sessão" }).click();
  await expect(page.getByText("O chamado")).toBeVisible();
  await openNavigation();
  await page.getByRole("link", { name: "Visão geral" }).click();
  await expect(
    page.getByRole("heading", { name: "Painel do aventureiro" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Blue Rose E2E" }).first(),
  ).toBeVisible();
  await attachThemeScreenshot("dashboard-light");
  await openNavigation();
  await page.getByRole("link", { name: "Configurações" }).click();
  await page.getByRole("radio", { name: /Escuro/u }).check();
  await openNavigation();
  await page.getByRole("link", { name: "Visão geral" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("heading", { name: "Painel do aventureiro" }),
  ).toBeVisible();
  await attachThemeScreenshot("dashboard-dark");
  await openNavigation();
  await page.getByRole("link", { name: "Biblioteca" }).click();
  await expect(
    page.getByRole("heading", { name: "Seu catálogo de RPGs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Blue Rose E2E" }).first(),
  ).toBeVisible();
  await attachThemeScreenshot("biblioteca-dark");
  await openNavigation();
  await page.getByRole("link", { name: "Configurações" }).click();
  await page.getByRole("radio", { name: /Claro/u }).check();
  await openNavigation();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await attachThemeScreenshot("login-light");
});
