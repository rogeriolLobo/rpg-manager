import { expect, test } from "@playwright/test";

// F-029 (BATCH16): VTT — fundação (Scene/Map/tokens), sem realtime — ver
// src/server/routes/vtt.ts.
test("VTT: cria cena, adiciona token, ativa para os jogadores e revela o token", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Mestre VTT ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-vtt-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`RPG VTT ${suffix}`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByLabel("Status da leitura").selectOption("READ");
  await page.getByLabel("Prioridade").selectOption("HIGH");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `RPG VTT ${suffix}` })).toBeVisible();

  await page.getByRole("link", { name: "Criar campanha" }).click();
  // A opção do RPG só existe no <select> depois que GET /rpgs resolve — espera o texto
  // aparecer antes de salvar (mesmo princípio do `toHaveValue("Aventureiro E2E")` do Narrador
  // em core-flow.spec.ts) para não submeter o formulário com o RPG ainda vazio.
  await expect(page.getByLabel("RPG")).toHaveValue(/.+/u);
  await page.getByLabel("Nome da campanha").fill(`Mesa VTT ${suffix}`);
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa VTT ${suffix}` })).toBeVisible();

  await page.getByRole("link", { name: "Mesa Virtual" }).click();
  await expect(page.getByRole("heading", { name: "VTT — cenas e tokens" })).toBeVisible();

  const sceneForm = page.locator("form").filter({ hasText: "Nova cena" });
  await sceneForm.getByLabel("Título").fill("Câmara do Dragão");
  await sceneForm.getByLabel("URL da imagem de fundo").fill("https://example.com/camara.png");
  await page.getByRole("button", { name: "Criar cena" }).click();
  await expect(page.getByText("Câmara do Dragão")).toBeVisible();

  await page.getByRole("button", { name: "Expandir cena" }).click();
  const tokenForm = page.locator("form.inline-form").filter({ hasText: "Adicionar token" });
  await tokenForm.getByLabel("Rótulo").fill("Dragão Vermelho");
  await page.getByRole("button", { name: "Adicionar token" }).click();
  await expect(page.getByText("Dragão Vermelho").first()).toBeVisible();
  await expect(page.getByText("oculto (GM only)")).toBeVisible();

  await page.getByRole("button", { name: "Ativar para os jogadores" }).click();
  await expect(page.getByText("Ao vivo")).toBeVisible();

  await page.getByRole("button", { name: "Revelar" }).click();
  await expect(page.getByText("visível aos jogadores")).toBeVisible();

  await page.getByRole("button", { name: "Excluir token Dragão Vermelho" }).click();
  await expect(page.getByText("Nenhum token nesta cena.")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Excluir cena Câmara do Dragão" }).click();
  await expect(page.getByText("Nenhuma cena criada ainda.")).toBeVisible();
});
