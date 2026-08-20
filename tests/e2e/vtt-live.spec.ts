import { expect, test, type Page } from "@playwright/test";

// F-031 (BATCH17, correção 2026-08-20): visão "ao vivo" do jogador — WebSocket real (Durable
// Object) preferido, polling sobre GET /vtt/:campaignId/live como fallback — ver
// docs/architecture/VTT_REALTIME_ZERO_COST_AUDIT.md. Setup de amizade/grupo/campanha via API
// (page.request, mesma sessão do browser) para o teste focar no comportamento real sob teste
// (a visão ao vivo do jogador) em vez de repetir os fluxos de UI já cobertos em
// social-friends.spec.ts/social-library-invites.spec.ts. Timeouts mais folgados que o default
// do projeto (10s) porque este teste depende do runtime local de Durable Object do
// `wrangler dev`/vite-plugin, que soma latência real de D1 + Durable Object + WebSocket —
// mais lento que uma rota HTTP comum, não um `waitForTimeout` cego (ver tests/e2e/vtt-realtime.spec.ts,
// que valida a velocidade real de entrega via WebSocket separadamente).
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
// documentado em vault-worlds-flow.spec.ts, que usa o mesmo padrão).
const apiHeaders = (csrf: string) => ({ "X-CSRF-Token": csrf, Origin: "http://127.0.0.1:5173" });

test("VTT ao vivo (F-031): jogador acessa o link direto, vê a cena/token, e o combate aparece após o mestre iniciar", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  const ownerEmail = `e2e-vtt-live-owner-${suffix}@example.com`;
  const playerEmail = `e2e-vtt-live-player-${suffix}@example.com`;
  await register(page, ownerEmail, `Mestre Live ${suffix}`);

  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await register(playerPage, playerEmail, `Jogador Live ${suffix}`);
  const playerId = await playerPage.evaluate(async () => {
    const body = (await (await fetch("/api/v1/auth/session")).json()) as { user: { id: string } };
    return body.user.id;
  });

  const ownerCsrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(ownerCsrf),
    data: { title: `RPG Live ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const groupResponse = await page.request.post("/api/v1/groups", { headers: apiHeaders(ownerCsrf), data: { name: `Grupo Live ${suffix}`, notes: "" } });
  const groupId = ((await groupResponse.json()) as { item: { id: string } }).item.id;
  await page.request.post(`/api/v1/groups/${groupId}/members`, { headers: apiHeaders(ownerCsrf), data: { playerName: "Jogador", userId: playerId, notes: "", active: true, isGameMaster: false } });
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(ownerCsrf),
    data: { rpgId, name: `Mesa Live ${suffix}`, status: "PLANNING", gameMaster: "", playGroupId: groupId, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  const sceneResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(ownerCsrf), data: { title: "Cena Ao Vivo", mapId: null, imageUrl: "https://example.com/live-e2e.png", notes: "" } });
  const sceneId = ((await sceneResponse.json()) as { id: string }).id;
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/tokens`, { headers: apiHeaders(ownerCsrf), data: { label: "Herói", entityId: null, x: 40, y: 60, visibleToPlayers: true } });
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/activate`, { headers: apiHeaders(ownerCsrf), data: {} });

  await playerPage.goto(`/app/campaigns/${campaignId}/vtt/live`);
  // Timeout folgado: primeira conexão de WebSocket/Durable Object desta Campaign soma latência
  // real de D1 + Durable Object + coordenação do runtime local — bem acima do timeout padrão
  // de asserção do projeto (10s), sem ser um `waitForTimeout` cego.
  await expect(playerPage.getByRole("heading", { name: "Cena Ao Vivo" })).toBeVisible({ timeout: 30_000 });
  await expect(playerPage.locator(".vtt-token").filter({ hasText: "HE" })).toBeVisible();

  // Mestre inicia combate DEPOIS do jogador já estar na tela — chega via WebSocket (ou, se a
  // conexão cair, pelo poll de fallback em até 3s), provando que a visão realmente atualiza
  // sozinha sem reload manual.
  await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/combat/start`, {
    headers: apiHeaders(ownerCsrf),
    data: { combatants: [{ tokenId: null, name: "Herói", initiative: 15, hpCurrent: 20, hpMax: 20, notes: "", visibleToPlayers: true }] },
  });
  await expect(playerPage.getByText("Round 1")).toBeVisible({ timeout: 15_000 });
  await expect(playerPage.getByText("Turno atual")).toBeVisible();

  // Não-membro nunca acessa (anti-enumeração, mesmo estado amigável de "não encontrado").
  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await register(outsiderPage, `e2e-vtt-live-outsider-${suffix}@example.com`, `Fora Live ${suffix}`);
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
