import { expect, test } from "@playwright/test";

// F-024: One-Shot é um Formato dentro do mesmo formulário de campanha (nunca um domínio
// separado) — mas sem um atalho visível na tela de Campanhas, a opção não era descoberta
// (achado real do usuário: "não conseguimos criar OneShot"). "Nova mesa única" pré-seleciona
// o Formato via query param — ver src/client/pages/campaign-pages.tsx.
//
// Seção 14 do pedido de finalização: a partir daqui a jornada continua pedindo o fluxo COMPLETO
// (criar → adicionar Player/Character → Session → VTT → concluir sessão), rodando em qualquer
// projeto do playwright.config.ts (desktop `chromium` + `mobile-chromium`, sem restrição de
// project neste arquivo) — discovery do botão continua sendo parte do teste, sem repetir.
test("Campanhas: atalho 'Nova mesa única' pré-seleciona o Formato One-Shot e a mesa criada aparece marcada na listagem", async ({ page }) => {
  test.setTimeout(120_000);
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

  // ---- Seção 14: adicionar Player + Character (mesmo formulário, jogador de mesa única sem
  // conta cadastrada é o caso mais comum) — UI real. ----
  // getByText("Mesa Única") faria match parcial/case-insensitive também no atalho "Nova mesa
  // única" (que aparece ANTES na página, na ação do PageHeader) — usa o heading do card, único.
  await page.getByRole("heading", { name: `Mesa Única ${suffix}`, level: 2 }).click();
  await expect(page.getByRole("heading", { name: `Mesa Única ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Nome do jogador").fill("Jogador Convidado");
  await page.getByLabel("Nome do personagem").fill("Aventureira Improvável");
  await page.getByRole("button", { name: "Adicionar" }).click();
  // A linha do membro recém-criado renderiza como campos editáveis (CampaignMemberEditor), não
  // texto solto — confirma pelo valor dos inputs, não por getByText (que só casa texto real).
  await expect(page.getByLabel("Jogador Jogador Convidado")).toHaveValue("Jogador Convidado", { timeout: 10_000 });
  await expect(page.getByLabel("Personagem de Jogador Convidado")).toHaveValue("Aventureira Improvável");

  // ---- Session: registra a sessão única, com o jogador marcado como participante. ----
  await page.getByRole("link", { name: "Registrar sessão" }).first().click();
  await expect(page.getByRole("heading", { name: "Registrar sessão" })).toBeVisible();
  await page.getByLabel("Título").fill("Sessão única");
  await page.getByText("Jogador Convidado").click();
  await page.getByRole("button", { name: "Salvar sessão" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Única ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Sessão única")).toBeVisible();

  // ---- VTT: toca a Mesa Virtual (discovery + reachability — a fundo já coberto em vtt.spec.ts). ----
  await page.getByRole("link", { name: "Mesa Virtual" }).click();
  await expect(page.getByRole("heading", { name: "VTT — cenas e tokens" })).toBeVisible({ timeout: 15_000 });

  // ---- Concluir: mesa única jogada, marca a campanha como Concluída. ----
  await page.getByRole("link", { name: "Voltar à campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Única ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Editar" }).click();
  // Espera o fetch assíncrono da campanha existente assentar ANTES de interagir com o form —
  // mesmo achado real já documentado em vault-worlds-flow.spec.ts (StrictMode/dev pode disparar
  // o fetch em duplicidade; sem esperar, a seleção corre risco de ser sobrescrita pelo fetch
  // tardio quando ele finalmente resolve, revertendo silenciosamente para o valor original).
  await expect(page.getByLabel("Nome da campanha")).toHaveValue(`Mesa Única ${suffix}`, { timeout: 15_000 });
  await page.getByLabel("Status").selectOption("COMPLETED");
  await page.getByRole("button", { name: "Salvar campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Única ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Concluída").first()).toBeVisible();

  await page.goto("/app/campaigns");
  await expect(page.getByText("Concluída").first()).toBeVisible();
});
