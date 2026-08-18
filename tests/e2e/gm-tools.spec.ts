import { expect, test } from "@playwright/test";

// F-004 (GM Tools): rolador de dados + timer, acessíveis globalmente (independente de World).
test("Ferramentas do Mestre: rolar dados e operar o timer", async ({ page }) => {
  test.setTimeout(60_000);
  const email = `e2e-gmtools-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill("Mestre de Testes");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);

  if ((page.viewportSize()?.width ?? 1000) <= 850) await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("link", { name: "Ferramentas do Mestre" }).click();
  await expect(page.getByRole("heading", { name: "Prepare a mesa" })).toBeVisible();

  // Rolador de dados: notação válida gera um resultado numérico visível.
  await page.getByLabel("Notação").fill("2d6+3");
  await page.getByRole("button", { name: "Rolar" }).click();
  await expect(page.getByText("2d6+3", { exact: true })).toBeVisible();

  // Notação inválida mostra erro claro, sem travar a tela.
  await page.getByLabel("Notação").fill("dado estranho");
  await page.getByRole("button", { name: "Rolar" }).click();
  await expect(page.getByText("Use o formato NdM", { exact: false })).toBeVisible();

  // Timer: iniciar mostra a contagem, pausar/zerar funcionam.
  await expect(page.getByRole("timer")).toHaveText("--:--");
  await page.getByRole("button", { name: "Iniciar" }).click();
  await expect(page.getByRole("timer")).toHaveText("05:00");
  await page.getByRole("button", { name: "Pausar" }).click();
  await page.getByRole("button", { name: "Zerar" }).click();
  await expect(page.getByRole("timer")).toHaveText("--:--");
});
