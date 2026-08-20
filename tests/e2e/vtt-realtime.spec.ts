import { expect, test, type Page } from "@playwright/test";

// F-031 (correção 2026-08-20): realtime real via Durable Object + WebSocket — ver
// src/server/vtt-room-do.ts, src/server/routes/vtt.ts e
// docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md. Este teste prova, com dois contextos de
// browser reais (GM + Player), que a visão do jogador atualiza sozinha SEM reload manual e SEM
// esperar o intervalo do polling de fallback (3s) — o selo "● Tempo real" só aparece quando o
// WebSocket conecta, e a atualização precisa chegar bem mais rápido que o poll antigo provaria
// (ver tests/e2e/vtt-live.spec.ts, que continua cobrindo o fallback de polling). Timeout inicial
// folgado pelo mesmo motivo documentado em vtt-live.spec.ts (primeira conexão de Durable Object
// desta Campaign soma latência real do runtime local) — depois de conectado, os timeouts das
// atualizações em si continuam curtos de propósito (provam que chegaram via WebSocket, não pelo
// poll de 3s de fallback).
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
// page.request não simula todos os headers de um navegador real — sem Origin explícito, o
// requireTrustedOrigin do backend rejeita o POST antes de chegar na rota (mesmo achado real já
// documentado em vault-worlds-flow.spec.ts/vtt-live.spec.ts).
const apiHeaders = (csrf: string) => ({ "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:5173" });

test("VTT realtime (F-031): jogador conectado via WebSocket vê o token do mestre aparecer sozinho, sem reload e sem esperar o poll", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-vtt-rt-owner-${suffix}@example.com`;
  const playerEmail = `e2e-vtt-rt-player-${suffix}@example.com`;
  await register(page, ownerEmail, `Mestre RT ${suffix}`);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await register(playerPage, playerEmail, `Jogador RT ${suffix}`);
  const playerId = await playerPage.evaluate(async () => {
    const body = (await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } };
    return body.user.id;
  });

  const ownerCsrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(ownerCsrf),
    data: { title: `RPG RT ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const groupResponse = await page.request.post("/api/v1/groups", { headers: apiHeaders(ownerCsrf), data: { name: `Grupo RT ${suffix}`, notes: "" } });
  const groupId = ((await groupResponse.json()) as { item: { id: string } }).item.id;
  await page.request.post(`/api/v1/groups/${groupId}/members`, { headers: apiHeaders(ownerCsrf), data: { playerName: "Jogador", userId: playerId, notes: "", active: true, isGameMaster: false } });
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(ownerCsrf),
    data: { rpgId, name: `Mesa RT ${suffix}`, status: "PLANNING", gameMaster: "", playGroupId: groupId, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  const sceneResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(ownerCsrf), data: { title: "Cena Realtime E2E", mapId: null, imageUrl: "https://example.com/rt-e2e.png", notes: "" } });
  const sceneId = ((await sceneResponse.json()) as { id: string }).id;
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/activate`, { headers: apiHeaders(ownerCsrf), data: {} });

  await playerPage.goto(`/app/campaigns/${campaignId}/vtt/live`);
  await expect(playerPage.getByRole("heading", { name: "Cena Realtime E2E" })).toBeVisible({ timeout: 30_000 });
  // Confirma que o WebSocket realmente conectou (nunca ficou preso no polling de fallback) —
  // só então a asserção de velocidade abaixo prova algo sobre o realtime, não sobre o poll.
  await expect(playerPage.getByText("● Tempo real")).toBeVisible({ timeout: 15_000 });

  // Move o token DEPOIS do jogador já estar conectado — se aparecer bem antes do intervalo do
  // polling de fallback (3s), só pode ter chegado pelo WebSocket.
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/tokens`, { headers: apiHeaders(ownerCsrf), data: { label: "Herói", entityId: null, x: 40, y: 60, visibleToPlayers: true } });
  await expect(playerPage.locator(".vtt-token").filter({ hasText: "HE" })).toBeVisible({ timeout: 1_500 });

  // Segundo evento: revela combate — mesma conexão, mesma velocidade, prova que não foi coincidência.
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/combat/start`, {
    headers: apiHeaders(ownerCsrf),
    data: { combatants: [{ tokenId: null, name: "Herói", initiative: 15, hpCurrent: 20, hpMax: 20, notes: "", visibleToPlayers: true }] },
  });
  await expect(playerPage.getByText("Round 1")).toBeVisible({ timeout: 1_500 });
  await expect(playerPage.getByText("Turno atual")).toBeVisible();

  // Não-membro nunca faz upgrade de WebSocket (mesma authorization de GET /live, 404).
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await register(outsiderPage, `e2e-vtt-rt-outsider-${suffix}@example.com`, `Fora RT ${suffix}`);
  await outsiderPage.goto(`/app/campaigns/${campaignId}/vtt/live`);
  await expect(outsiderPage.getByRole("heading", { name: "Não encontrado" })).toBeVisible({ timeout: 30_000 });

  // BATCH19: contexts extras criados via browser.newContext() nunca fecham sozinhos — sem
  // isso, ficavam abertos pelo resto da fila de testes do worker (workers:1, mesmo processo/
  // browser para toda a suíte), com o WebSocket de playerPage ainda conectado ao Durable
  // Object, acumulando memória/conexões até travar um teste bem mais adiante (achado real:
  // causa raiz do flake recorrente de vault-worlds-flow.spec.ts).
  await playerContext.close();
  await outsiderContext.close();
});
