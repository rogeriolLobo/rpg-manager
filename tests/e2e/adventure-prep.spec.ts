import { expect, test } from "@playwright/test";

// F-025 (BATCH13): Adventures aprofundadas — acts/scenes/encounters/handouts — ver
// src/server/routes/adventures.ts.
test("Preparação de Aventura: cria cena, encontro, vincula NPC do Vault e cria handout", async ({ page }) => {
  // Este fluxo encadeia várias gravações reais no Worker/D1. Cada transição preserva
  // a asserção funcional, mas recebe margem local para ambientes de CI mais lentos.
  test.setTimeout(300_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Mestre Aventura ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-adventure-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  // NPC a ser vinculado depois — nunca duplicado, só referenciado.
  await page.goto("/app/vault/new");
  await page.getByLabel("Nome", { exact: true }).fill(`Vilão ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Vilão ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.goto("/app/vault/new?type=ADVENTURE");
  await page.getByLabel("Nome", { exact: true }).fill(`Aventura ${suffix}`);
  await page.getByRole("button", { name: "Salvar entidade" }).click();
  await expect(page.getByRole("heading", { name: `Aventura ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Preparar aventura" }).click();
  await expect(page.getByRole("heading", { name: `Aventura ${suffix}` })).toBeVisible({ timeout: 30_000 });

  const sceneForm = page.locator("form").filter({ hasText: "Nova cena" });
  await sceneForm.getByLabel("Ato (opcional)").fill("Ato 1");
  await sceneForm.getByLabel("Título").fill("A Emboscada");
  await sceneForm.getByLabel("Resumo").fill("Os heróis são cercados na estrada.");
  await page.getByRole("button", { name: "Criar cena" }).click();
  await expect(page.getByText("Ato 1 · A Emboscada")).toBeVisible({ timeout: 30_000 });

  // Expande a cena para adicionar encontro e vincular o NPC.
  await page.getByRole("button", { name: "Expandir cena" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Emboscada dos bandidos");
  await page.getByRole("button", { name: "Adicionar encontro" }).click();
  await expect(page.getByText("Emboscada dos bandidos")).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Entidade do Vault").selectOption({ label: `Vilão ${suffix} (NPC)` });
  await page.getByLabel("Papel na cena").fill("Antagonista");
  await page.getByRole("button", { name: "Vincular" }).click();
  await expect(page.getByRole("link", { name: `Vilão ${suffix}` })).toBeVisible({ timeout: 30_000 });

  // Handout.
  const handoutForm = page.locator("form").filter({ hasText: "Novo handout" });
  await handoutForm.getByLabel("Título", { exact: true }).fill("Mapa da região");
  await handoutForm.getByLabel("Conteúdo").fill("Um mapa desenhado à mão.");
  // force:true — em mobile o textarea recém-preenchido intercepta o evento de clique do
  // botão logo abaixo por um instante (mesma altura de viewport reduzida), sem relação com
  // a funcionalidade em si (já validada no desktop).
  await handoutForm.getByRole("button", { name: "Criar handout" }).click({ force: true });
  await expect(page.getByText("Mapa da região")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("ainda não revelado")).toBeVisible();
  await page.getByRole("button", { name: "Revelar" }).click();
  await expect(page.getByText("revelado aos jogadores")).toBeVisible({ timeout: 30_000 });
});
