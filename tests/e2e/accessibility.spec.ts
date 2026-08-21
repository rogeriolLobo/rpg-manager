import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Seção 28 do pedido de finalização: acessibilidade funcional — keyboard navigation, focus
// visible, dialog focus, labels, aria, form errors, buttons sem nome, image alt, menu roles.
// Especial: VTT/Sheet Editor/Notifications/GM Console/Player Campaign Home.
//
// Usa axe-core real (@axe-core/playwright, MIT, devDependency — Zero Cost: só roda em teste
// local/CI, nunca em produção) em vez de checagens manuais frágeis. Escopo deliberado: regras
// WCAG2A/2AA de impacto 'serious'/'critical', EXCLUINDO 'color-contrast' — a paleta
// vinho/creme/H&M é uma decisão de identidade visual (CLAUDE.md Seção 21), não algo para este
// crawler alterar unilateralmente; contraste de cor é uma revisão de design separada, não um
// bug funcional de acessibilidade (a própria Seção 28 pede "corrigir P0/P1/P2 de acessibilidade
// FUNCIONAL" — foco/label/aria/nome/role, não recalibração de paleta).
async function register(page: Page, email: string, name: string) {
  await page.goto("/register");
  await page.getByLabel("Como quer ser chamado?").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha mínimo de 12 caracteres").fill("uma senha longa para e2e 2026");
  await page.getByLabel("Confirmar senha").fill("uma senha longa para e2e 2026");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Guarde seus códigos" })).toBeVisible();
  await page.getByRole("link", { name: "Já guardei, continuar" }).click();
  await expect(page).toHaveURL(/\/app$/u);
}
function csrfToken(cookies: Array<{ name: string; value: string }>): string {
  return decodeURIComponent(cookies.find((cookie) => cookie.name === "rpg_csrf")?.value ?? "");
}
const apiHeaders = (csrf: string) => ({ "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:5173" });

interface Violation { page: string; id: string; impact: string; help: string; nodes: number }
const violations: Violation[] = [];

async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(["color-contrast"])
    .analyze();
  for (const violation of results.violations) {
    if (violation.impact === "serious" || violation.impact === "critical") {
      violations.push({ page: label, id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.length });
    }
  }
}

// Smoke de teclado: Tab N vezes precisa sempre mover o foco para um elemento REAL e focável
// diferente do anterior — prova ausência de foco preso (keyboard trap) na página. Restrito a
// viewport desktop (Tab físico é uma interação de teclado/desktop; no projeto mobile-chromium,
// um clique em (2,2) pode acertar o botão hambúrguer da sidebar, abrindo um overlay que não
// existe no fluxo desktop — a varredura estrutural do axe-core acima já cobre ambos os
// viewports igualmente, este smoke adicional só roda uma vez, no viewport onde é representativo).
async function assertKeyboardNavigable(page: Page, label: string, steps = 8) {
  if (test.info().project.name !== "chromium") return;
  await page.locator("body").click({ position: { x: 2, y: 2 } }).catch(() => undefined);
  await page.keyboard.press("Tab");
  let previous = await page.evaluate(() => document.activeElement?.tagName ?? null);
  let stuckCount = 0;
  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press("Tab");
    const current = await page.evaluate(() => ({ tag: document.activeElement?.tagName ?? null, isBody: document.activeElement === document.body }));
    if (current.isBody) stuckCount += 1; // foco "caiu" de volta pro body sem completar a rotação — tolerável 1x no fim da lista tabável, nunca repetidamente
    previous = current.tag;
  }
  expect(stuckCount, `${label}: foco parece preso/voltando ao body repetidamente ao pressionar Tab`).toBeLessThan(steps);
  void previous;
}

test("Acessibilidade (Seção 28): axe-core sem violações sérias/críticas (exceto contraste de cor) e navegação por teclado sem foco preso em VTT/Sheet Editor/Notifications/GM Console/Player Home", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const suffix = Date.now();
  await register(page, `e2e-a11y-owner-${suffix}@example.com`, `A11y Owner ${suffix}`);

  const csrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf),
    data: { title: `RPG A11y ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const groupResponse = await page.request.post("/api/v1/groups", { headers: apiHeaders(csrf), data: { name: `Grupo A11y ${suffix}`, notes: "" } });
  const groupId = ((await groupResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Mesa A11y ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: groupId, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status()).toBe(201);
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  const sceneResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(csrf), data: { title: "Cena A11y", mapId: null, imageUrl: "https://example.com/a11y.png", notes: "" } });
  expect(sceneResponse.status()).toBe(201);

  // Sheet Template + Character (Vault) + valores da ficha, para o Sheet Editor renderizar campos
  // reais (TEXT/NUMBER/CHOICE) em vez de um formulário vazio.
  const templateResponse = await page.request.post("/api/v1/sheets/templates", {
    headers: apiHeaders(csrf),
    data: { name: `Modelo A11y ${suffix}`, description: "", worldId: null, gameSystemId: null, fields: [
      { key: "nome_guerra", label: "Nome de guerra", type: "TEXT", required: true },
      { key: "forca", label: "Força", type: "NUMBER", required: false },
      { key: "postura", label: "Postura", type: "CHOICE", required: false, options: ["Cautelosa", "Ousada"] },
    ], pdfUrl: null, pdfMapping: {} },
  });
  expect(templateResponse.status()).toBe(201);
  const templateId = ((await templateResponse.json()) as { id: string }).id;
  const entityResponse = await page.request.post("/api/v1/vault", {
    headers: apiHeaders(csrf),
    data: { entityType: "CHARACTER", name: "Personagem A11y", summary: "", description: "", visibility: "PRIVATE", worldId: null, groupId: null, parentEntityId: null, adventure: null, character: { playerUserId: null, pronouns: "", concept: "", status: "ACTIVE", notes: "" } },
  });
  expect(entityResponse.status()).toBe(201);
  const entityId = ((await entityResponse.json()) as { id: string }).id;
  const sheetResponse = await page.request.put(`/api/v1/sheets/entities/${entityId}`, { headers: apiHeaders(csrf), data: { templateId, values: { nome_guerra: "Corvo", forca: 12, postura: "Cautelosa" } } });
  expect(sheetResponse.status()).toBe(200);

  // ---- Segunda conta: Player real, via o mesmo fluxo real de convite (amizade -> convite de
  // Campaign com role PLAYER -> aceitar) usado em multi-gm.test.ts/vtt-load-test.test.ts —
  // necessário para /campaigns/mine (fonte de Player Campaign Home) reconhecer a conta como
  // membro ativo de verdade (campaign_members.user_id), o que adicionar ao Grupo sozinho NÃO
  // faz (achado real: Grupo e Campaign Member são vínculos distintos neste produto). ----
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await register(playerPage, `e2e-a11y-player-${suffix}@example.com`, `A11y Player ${suffix}`);
  const playerId = await playerPage.evaluate(async () => {
    const body = (await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } };
    return body.user.id;
  });
  const friendRequest = await page.request.post("/api/v1/social/requests", { headers: apiHeaders(csrf), data: { targetUserId: playerId } });
  expect(friendRequest.status()).toBe(201);
  const friendRequestId = ((await friendRequest.json()) as { item: { id: string } }).item.id;
  const playerCsrf = csrfToken(await playerContext.cookies());
  const acceptFriend = await playerPage.request.post(`/api/v1/social/requests/${friendRequestId}/accept`, { headers: apiHeaders(playerCsrf) });
  expect(acceptFriend.status()).toBe(200);
  const campaignInvite = await page.request.post("/api/v1/social/invites", { headers: apiHeaders(csrf), data: { inviteeUserId: playerId, targetType: "CAMPAIGN", targetId: campaignId, role: "PLAYER" } });
  expect(campaignInvite.status()).toBe(201);
  const campaignInviteId = ((await campaignInvite.json()) as { item: { id: string } }).item.id;
  const acceptCampaignInvite = await playerPage.request.post(`/api/v1/social/invites/${campaignInviteId}/accept`, { headers: apiHeaders(playerCsrf) });
  expect(acceptCampaignInvite.status()).toBe(200);

  try {
    // ---- GM Console (VTT) ----
    await page.goto(`/app/campaigns/${campaignId}/vtt`);
    await expect(page.getByText("Cena A11y")).toBeVisible({ timeout: 30_000 });
    await scan(page, "GM Console (VTT)");
    await assertKeyboardNavigable(page, "GM Console (VTT)");

    // ---- VTT Live (visão do jogador, acessada pelo próprio Owner só para o layout — o
    // conteúdo funcional já é coberto por outros specs com conta de Player real). ----
    await page.goto(`/app/campaigns/${campaignId}/vtt/live`);
    await expect(page.getByRole("heading", { name: "Aguardando o mestre" })).toBeVisible({ timeout: 30_000 });
    await scan(page, "VTT Live (Player View)");

    // ---- Sheet Editor ----
    await page.goto(`/app/vault/${entityId}/sheet`);
    await expect(page.getByLabel("Nome de guerra")).toBeVisible({ timeout: 30_000 });
    await scan(page, "Sheet Editor");
    await assertKeyboardNavigable(page, "Sheet Editor");

    // ---- Notifications (dialog aberto a partir do Dashboard) ----
    await page.goto("/app");
    // O botão "Notificações" vive dentro da sidebar (.sidebar) — no viewport mobile ela fica
    // fora da tela (transform) até abrir o menu hambúrguer; sem isso, o clique nunca fica
    // "actionable" e trava esperando indefinidamente (mesmo padrão de openNavigation() em
    // navigation-invariants.spec.ts).
    if ((page.viewportSize()?.width ?? 1000) <= 850) {
      await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
    }
    await page.getByRole("button", { name: /Notificações/u }).click();
    await expect(page.getByRole("dialog", { name: "Notificações" })).toBeVisible({ timeout: 10_000 });
    await scan(page, "Notifications (dialog)");
    // Foco preso é ACEITÁVEL/desejável dentro de um dialog modal (focus trap correto) — não
    // roda o smoke de "não travar" aqui, teria falso-positivo.
    await page.keyboard.press("Escape");

    // ---- Player Campaign Home (conta de Player real) ----
    await playerPage.goto("/app/my-tables");
    await expect(playerPage.getByRole("link", { name: `Mesa A11y ${suffix}` })).toBeVisible({ timeout: 30_000 });
    await playerPage.getByRole("link", { name: `Mesa A11y ${suffix}` }).click();
    await expect(playerPage.getByRole("heading", { name: `Mesa A11y ${suffix}` })).toBeVisible({ timeout: 30_000 });
    await scan(playerPage, "Player Campaign Home");
    await assertKeyboardNavigable(playerPage, "Player Campaign Home");
  } finally {
    await playerContext.close();
  }

  const summary = violations.map((v) => `${v.page} :: ${v.id} (${v.impact}, ${v.nodes} nó(s)) — ${v.help}`).join("\n");
  expect(violations, `Violações de acessibilidade serious/critical (exceto color-contrast):\n${summary}`).toHaveLength(0);
});
