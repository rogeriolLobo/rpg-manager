import { expect, test } from "@playwright/test";

// F-030 (BATCH16): VTT — fog of war / visibilidade por grade — ver src/server/routes/vtt.ts.
test("VTT: cria cena com névoa, revela uma célula e depois reencobre tudo", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Mestre Névoa ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-vtt-fog-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`RPG Névoa ${suffix}`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByLabel("Status da leitura").selectOption("READ");
  await page.getByLabel("Prioridade").selectOption("HIGH");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `RPG Névoa ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Criar campanha" }).click();
  await expect(page.getByLabel("RPG")).toHaveValue(/.+/u, { timeout: 30_000 });
  await page.getByLabel("Nome da campanha").fill(`Mesa Névoa ${suffix}`);
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Névoa ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Mesa do Mestre" }).click();
  await expect(page.getByRole("heading", { name: "VTT — cenas e tokens" })).toBeVisible();

  const sceneForm = page.locator("form").filter({ hasText: "Nova cena" });
  await sceneForm.getByLabel("Título").fill("Cripta Selada");
  await sceneForm.getByLabel("URL da imagem de fundo").fill("https://example.com/cripta.png");
  await sceneForm.getByLabel(/Névoa da guerra/u).check();
  await sceneForm.getByLabel("Colunas da grade").fill("4");
  await sceneForm.getByLabel("Linhas da grade").fill("4");
  await page.getByRole("button", { name: "Criar cena" }).click();
  await expect(page.getByText("Cripta Selada")).toBeVisible();

  await page.getByRole("button", { name: "Expandir cena" }).click();
  await expect(page.getByText("Névoa da guerra ativa")).toBeVisible();

  const cell = page.getByRole("button", { name: "Névoa 0,0 oculta" });
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page.getByRole("button", { name: "Névoa 0,0 revelada" })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Reencobrir tudo" }).click();
  await expect(page.getByRole("button", { name: "Névoa 0,0 oculta" })).toBeVisible();
});
