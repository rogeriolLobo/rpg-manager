import { expect, test } from "@playwright/test";

// F-024: One-Shot é um Formato dentro do mesmo formulário de campanha (nunca um domínio
// separado) — mas sem um atalho visível na tela de Campanhas, a opção não era descoberta
// (achado real do usuário: "não conseguimos criar OneShot"). "Nova mesa única" pré-seleciona
// o Formato via query param — ver src/client/pages/campaign-pages.tsx.
test("Campanhas: atalho 'Nova mesa única' pré-seleciona o Formato One-Shot e a mesa criada aparece marcada na listagem", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`OneShot ${suffix}`);
  await page.getByLabel("E-mail").fill(`oneshot-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`RPG OneShot ${suffix}`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByLabel("Status da leitura").selectOption("READ");
  await page.getByLabel("Prioridade").selectOption("HIGH");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `RPG OneShot ${suffix}` })).toBeVisible();

  await page.goto("/app/campaigns");
  await page.getByRole("link", { name: "Nova mesa única" }).click();
  await expect(page).toHaveURL(/sessionMode=ONE_SHOT/u);
  await expect(page.getByLabel("Formato")).toHaveValue("ONE_SHOT");
  await page.getByLabel("RPG").selectOption({ label: `RPG OneShot ${suffix}` });
  await page.getByLabel("Nome da campanha").fill(`Mesa Única ${suffix}`);
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Única ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("One-Shot").first()).toBeVisible();

  await page.goto("/app/campaigns");
  await expect(page.getByText("One-Shot").first()).toBeVisible();
});
