import { expect, test, type Page, type WebSocket as PlaywrightWebSocket } from "@playwright/test";

// Seção 9 do pedido de finalização: cleanup de WebSocket é obrigatório em
// unmount/reconnect — "criar testes para evitar vazamento semelhante ao
// problema já encontrado com browser contexts" (ver comentário histórico em
// vtt-realtime.spec.ts). O hook compartilhado `useCampaignRealtime`
// (src/client/api/campaign-realtime.ts) fecha o socket no cleanup do seu
// useEffect — este teste prova isso com um WebSocket REAL do navegador
// (Playwright `page.on('websocket')`), não apenas lendo o código: ao sair da
// página (unmount) o socket precisa fechar sozinho, e ao voltar (remount) só
// UM socket novo pode abrir — nunca acumula conexões.
//
// Exercita a Mesa do Mestre (VttPage, `/vtt`), não a visão do jogador
// (`/vtt/live`): esta última só atualiza `wsScene` para mensagens com
// `role==='PLAYER'` (filtro deliberado — ver campaign-realtime.ts), então o
// próprio Owner/GM navegando até `/vtt/live` nunca veria uma cena carregada
// via WS (não é um bug: `/vtt/live` é a visão do JOGADOR por design, os
// testes de realtime existentes sempre usam uma conta de Player separada
// para essa rota — ver vtt-realtime.spec.ts/vtt-live.spec.ts). A Mesa do
// Mestre é justamente o hook que foi acrescentado nesta rodada (Multi-GM
// F-036 expôs que o console do GM não tinha NENHUMA assinatura de realtime).
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

async function waitForClose(ws: PlaywrightWebSocket): Promise<void> {
  if (ws.isClosed()) return;
  // Timeout curto e explícito (em vez de esperar indefinidamente): se o cleanup do hook
  // realmente vazasse a conexão, isto falha com uma mensagem clara, nunca trava o teste inteiro
  // até o timeout global de 180s.
  await ws.waitForEvent("close", { timeout: 15_000 });
}

test("VTT realtime cleanup (Seção 9): sair da página fecha o WebSocket; voltar abre só um novo, sem acumular conexões", async ({ page }) => {
  test.setTimeout(180_000);
  const suffix = Date.now();
  await register(page, `e2e-vtt-cleanup-owner-${suffix}@example.com`, `Mestre Cleanup ${suffix}`);

  const csrf = csrfToken(await page.context().cookies());
  const rpgResponse = await page.request.post("/api/v1/rpgs", {
    headers: apiHeaders(csrf),
    data: { title: `RPG Cleanup ${suffix}`, categoryId: null, subgenreId: null, readingStatus: "READING", hasPlayed: false, wantsToPlay: true, priority: "HIGH", playGroupNotes: "", playGroupId: null, plannedPlayDate: null, tableStatus: "IDEA", gameMaster: "", notes: "", coverUrl: null },
  });
  expect(rpgResponse.status()).toBe(201);
  const rpgId = ((await rpgResponse.json()) as { item: { id: string } }).item.id;
  const campaignResponse = await page.request.post("/api/v1/campaigns", {
    headers: apiHeaders(csrf),
    data: { rpgId, name: `Mesa Cleanup ${suffix}`, status: "IN_PROGRESS", sessionMode: "CAMPAIGN", gameMaster: "", playGroupId: null, adventureEntityId: null, sessionZeroDate: null, firstSessionDate: null, frequency: null, nextSessionDate: null, sessionGoal: null, legacyMembersText: "", legacyCharactersText: "", notes: "" },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const campaignId = ((await campaignResponse.json()) as { item: { id: string } }).item.id;
  const sceneResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes`, { headers: apiHeaders(csrf), data: { title: "Cena Cleanup E2E", mapId: null, imageUrl: "https://example.com/cleanup-e2e.png", notes: "" } });
  expect(sceneResponse.status(), await sceneResponse.text()).toBe(201);
  const sceneId = ((await sceneResponse.json()) as { id: string }).id;
  const activateResponse = await page.request.post(`/api/v1/vtt/${campaignId}/scenes/${sceneId}/activate`, { headers: apiHeaders(csrf), data: {} });
  expect(activateResponse.status(), await activateResponse.text()).toBe(200);

  const openedSockets: PlaywrightWebSocket[] = [];
  page.on("websocket", (ws) => {
    if (ws.url().includes("/realtime")) openedSockets.push(ws);
  });

  // Navegação inicial (carregamento de documento completo) até a Campanha — fora da Mesa
  // Virtual, nenhum WebSocket ainda. Daqui em diante, toda navegação usa Links reais (React
  // Router client-side) em vez de page.goto: uma navegação de DOCUMENTO INTEIRO já garante
  // teardown do socket pelo próprio navegador (não prova nada sobre o nosso cleanup); o cleanup
  // do useEffect só é genuinamente testado quando o React desmonta o componente SEM recarregar
  // a página — exatamente o caso real de alguém navegando dentro do produto.
  await page.goto(`/app/campaigns/${campaignId}`);
  await expect(page.getByRole("heading", { name: `Mesa Cleanup ${suffix}` })).toBeVisible({ timeout: 15_000 });
  expect(openedSockets).toHaveLength(0);

  // ---- 1ª montagem (SPA): abre exatamente 1 WebSocket real de VTT. ----
  await page.getByRole("link", { name: "Mesa do Mestre" }).click();
  await expect(page.getByText("Cena Cleanup E2E")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/● Tempo real/u)).toBeVisible({ timeout: 15_000 });
  expect(openedSockets).toHaveLength(1);
  const firstSocket = openedSockets[0];
  expect(firstSocket.isClosed()).toBe(false);

  // ---- Unmount (SPA, sem reload): sair da Mesa Virtual de volta à Campanha precisa fechar o
  // socket sozinho — é o próprio cleanup do useEffect do hook compartilhado, nunca o navegador
  // fazendo isso por nós. ----
  await page.getByRole("link", { name: "Voltar à campanha" }).click();
  await expect(page.getByRole("heading", { name: `Mesa Cleanup ${suffix}` })).toBeVisible({ timeout: 15_000 });
  await waitForClose(firstSocket);
  expect(firstSocket.isClosed()).toBe(true);

  // ---- Remount (SPA): voltar à mesma página abre só UM socket novo — nunca reaproveita nem
  // acumula o antigo, e nunca abre mais de uma conexão para a mesma remontagem
  // (StrictMode-safe). ----
  await page.getByRole("link", { name: "Mesa do Mestre" }).click();
  await expect(page.getByText("Cena Cleanup E2E")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/● Tempo real/u)).toBeVisible({ timeout: 15_000 });
  expect(openedSockets).toHaveLength(2);
  const secondSocket = openedSockets[1];
  expect(secondSocket).not.toBe(firstSocket);
  expect(secondSocket.isClosed()).toBe(false);

  // ---- Limpeza final do próprio teste: sair de novo precisa fechar o segundo socket também. ----
  await page.getByRole("link", { name: "Voltar à campanha" }).click();
  await waitForClose(secondSocket);
  expect(secondSocket.isClosed()).toBe(true);
});
