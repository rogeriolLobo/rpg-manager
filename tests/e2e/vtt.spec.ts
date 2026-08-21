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
  await expect(page.getByRole("heading", { name: `RPG VTT ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Criar campanha" }).click();
  // A opção do RPG só existe no <select> depois que GET /rpgs resolve — espera o texto
  // aparecer antes de salvar (mesmo princípio do `toHaveValue("Aventureiro E2E")` do Narrador
  // em core-flow.spec.ts) para não submeter o formulário com o RPG ainda vazio.
  await expect(page.getByLabel("RPG")).toHaveValue(/.+/u, { timeout: 30_000 });
  await page.getByLabel("Nome da campanha").fill(`Mesa VTT ${suffix}`);
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa VTT ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Mesa do Mestre" }).click();
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
  // Escopado ao <li> do token DENTRO do corpo da cena expandida (não a qualquer <li> da
  // página) — o <li> da CENA em si também "contém" o texto "Dragão Vermelho" (o token está
  // aninhado dentro dele), então um `page.locator("li").filter(...)` sem escopo mais preciso
  // combina tanto o <li> da cena (que também tem o checkbox "Visível aos jogadores" do painel
  // de Combate, F-032) quanto o <li> do token — ambíguo. `.adventure-scene-body li` exclui o
  // <li> externo da cena (ele é ancestral do corpo, não descendente).
  await expect(page.locator(".adventure-scene-body li").filter({ hasText: "Dragão Vermelho" }).getByText("visível aos jogadores")).toBeVisible();

  await page.getByRole("button", { name: "Excluir token Dragão Vermelho" }).click();
  await expect(page.getByText("Nenhum token nesta cena.")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Excluir cena Câmara do Dragão" }).click();
  await expect(page.getByText("Nenhuma cena criada ainda.")).toBeVisible();
});

// F-032 (BATCH17): iniciativa/combate system-neutral, sobre a fundação do F-029.
test("VTT: inicia combate, adiciona combatente, avança turno, ajusta PV e encerra", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = Date.now();

  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(`Mestre Combate ${suffix}`);
  await page.getByLabel("E-mail").fill(`e2e-vtt-combat-${suffix}@example.com`);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();

  await page.goto("/app/library/new");
  await page.getByLabel("Título", { exact: true }).fill(`RPG Combate ${suffix}`);
  await page.getByLabel("Categoria").selectOption("fantasia");
  await page.getByLabel("Subgênero").selectOption("alta-fantasia");
  await page.getByLabel("Status da leitura").selectOption("READ");
  await page.getByLabel("Prioridade").selectOption("HIGH");
  await page.getByRole("button", { name: "Salvar RPG" }).click();
  await expect(page.getByRole("heading", { name: `RPG Combate ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Criar campanha" }).click();
  await expect(page.getByLabel("RPG")).toHaveValue(/.+/u, { timeout: 30_000 });
  await page.getByLabel("Nome da campanha").fill(`Mesa Combate ${suffix}`);
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Combate ${suffix}` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Mesa do Mestre" }).click();
  const sceneForm = page.locator("form").filter({ hasText: "Nova cena" });
  await sceneForm.getByLabel("Título").fill("Sala do Chefe");
  await sceneForm.getByLabel("URL da imagem de fundo").fill("https://example.com/chefe.png");
  await page.getByRole("button", { name: "Criar cena" }).click();
  await page.getByRole("button", { name: "Expandir cena" }).click();

  const startForm = page.locator("form.inline-form").filter({ hasText: "Iniciar combate" });
  await startForm.getByLabel("Primeiro combatente").fill("Herói");
  await startForm.getByLabel("Iniciativa").fill("15");
  await startForm.getByLabel("PV atual").fill("20");
  await startForm.getByLabel("PV máximo").fill("20");
  await page.getByRole("button", { name: "Iniciar combate" }).click();
  await expect(page.getByText("Round 1")).toBeVisible();
  await expect(page.getByText("Turno atual")).toBeVisible();
  await expect(page.getByText("PV 20/20")).toBeVisible();

  const addCombatantForm = page.locator("form.inline-form").filter({ hasText: "Adicionar combatente" });
  await addCombatantForm.getByLabel("Nome").fill("Chefe");
  await addCombatantForm.getByLabel("Iniciativa").fill("10");
  await page.getByRole("button", { name: "Adicionar combatente" }).click();
  await expect(page.getByText("Chefe")).toBeVisible();

  await page.getByRole("button", { name: "Aumentar PV de Herói" }).click();
  await expect(page.getByText("PV 21/20")).toBeVisible();

  await page.getByRole("button", { name: "Próximo turno" }).click();
  // Herói (iniciativa 15) passou o turno para Chefe (iniciativa 10, único restante) — ainda round 1.
  await expect(page.getByText("Round 1")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Encerrar combate" }).click();
  await expect(page.getByText("Iniciar combate")).toBeVisible();
  await expect(page.getByText("Round")).toHaveCount(0);
});
