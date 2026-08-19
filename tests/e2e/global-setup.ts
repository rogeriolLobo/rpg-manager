import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';

// RPG-1.0-BATCH5: readiness REAL, não timeout cego (seção 12/14 do pedido).
//
// `webServer.url` no playwright.config.ts já espera `/login` responder — mas isso só prova que
// o Vite dev server está de pé, não que cada CAMINHO de escrita do Worker já absorveu seu custo
// de primeira execução contra um arquivo D1 recém-migrado.
//
// Evidência real (trace de rede do Playwright, não suposição — ver
// docs/e2e/LOCAL_E2E_DIAGNOSTICS.md): um `POST /auth/register` isolado aquece em ~2s, mas o
// PRIMEIRO `POST /rpgs` de toda a suíte (que faz um `D1.batch` multi-tabela —
// game_systems+publications+rpgs, ver buildCreateLibraryEntryStatements) levou 7.6s sozinho, e o
// `GET /rpgs/:id` seguinte nunca chegou a responder dentro dos 10s de `expect.timeout` restantes
// — não é "worker genericamente frio" (registro já tinha aquecido o worker), é especificamente a
// primeira vez que ESSE formato de batch multi-tabela roda contra o arquivo D1 recém-criado.
// Requests seguintes do mesmo tipo são rápidos (confirmado: uma segunda rodada, com o mesmo
// arquivo D1 já tendo processado esse caminho antes, não reproduz o atraso).
//
// Este setup roda UMA VEZ antes de qualquer teste, percorre os caminhos de escrita mais pesados
// usados pela suíte (registro + criar RPG + criar World — descartados, nunca reaproveitados por
// um teste) com timeout próprio e generoso SÓ aqui — o `expect.timeout` global continua apertado
// o suficiente para pegar bug real de UI depois do warmup.
const WARMUP_TIMEOUT_MS = 60_000;
const BASE_URL = 'http://127.0.0.1:5173';

async function warmupStep(context: APIRequestContext, label: string, run: () => Promise<{ ok: boolean; status: number }>): Promise<boolean> {
  const start = Date.now();
  try {
    const result = await run();
    const elapsedMs = Date.now() - start;
    if (!result.ok) {
      console.warn(`[global-setup] warmup "${label}" respondeu ${result.status} em ${elapsedMs}ms — suíte segue mesmo assim (warmup é best-effort; uma app genuinamente quebrada ainda falha nos testes reais, com evidência melhor que um timeout de setup).`);
      return false;
    }
    console.log(`[global-setup] "${label}" aqueceu em ${elapsedMs}ms.`);
    return true;
  } catch (error) {
    console.warn(`[global-setup] warmup "${label}" falhou (${error instanceof Error ? error.message : String(error)}) — suíte segue.`);
    return false;
  }
}

// A API exige CSRF de dupla submissão (cookie `rpg_csrf` ecoado no header `X-CSRF-Token`, ver
// src/server/security/csrf.ts) em todo POST/PATCH/DELETE — sem isso, todo warmup além do
// registro falhava com 403 (achado real ao rodar isto pela primeira vez: o warmup em si tinha
// um bug, não o produto — registrado aqui para não se repetir).
async function csrfToken(context: APIRequestContext): Promise<string | undefined> {
  const state = await context.storageState();
  return state.cookies.find((cookie) => cookie.name === 'rpg_csrf')?.value;
}

export default async function globalSetup(): Promise<void> {
  const context = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Origin: BASE_URL }, timeout: WARMUP_TIMEOUT_MS });
  const email = `warmup-${Date.now()}@example.com`;
  try {
    const registered = await warmupStep(context, 'POST /auth/register', async () => {
      const response = await context.post('/api/v1/auth/register', { data: { email, displayName: 'Warmup', password: 'uma senha longa só para aquecer o worker 2026' } });
      return { ok: response.ok(), status: response.status() };
    });
    if (!registered) return; // sem sessão, não dá pra continuar aquecendo os próximos passos.
    const csrf = await csrfToken(context);
    if (!csrf) { console.warn('[global-setup] cookie CSRF ausente após registro — pulando o resto do warmup.'); return; }

    let rpgId: string | null = null;
    await warmupStep(context, 'POST /rpgs (D1.batch multi-tabela — o caminho historicamente lento)', async () => {
      const response = await context.post('/api/v1/rpgs', {
        headers: { 'X-CSRF-Token': csrf },
        data: {
          title: 'Warmup RPG', categoryId: null, subgenreId: null, readingStatus: 'NOT_STARTED', hasPlayed: false, wantsToPlay: false, priority: 'NONE',
          playGroupNotes: '', playGroupId: null, plannedPlayDate: null, tableStatus: 'IDEA', gameMaster: '', notes: '',
          coverUrl: null, isbn: null, coverSourceUrl: null, coverSourceNote: null,
        },
      });
      if (response.ok()) rpgId = ((await response.json()) as { item: { id: string } }).item.id;
      return { ok: response.ok(), status: response.status() };
    });

    if (rpgId) {
      await warmupStep(context, 'GET /rpgs/:id', async () => {
        const response = await context.get(`/api/v1/rpgs/${rpgId}`);
        return { ok: response.ok(), status: response.status() };
      });
      await warmupStep(context, 'POST /worlds (D1.batch — usado por quase todo fluxo da suíte)', async () => {
        const response = await context.post('/api/v1/worlds', { headers: { 'X-CSRF-Token': csrf }, data: { name: 'Warmup World', description: '', defaultRpgId: rpgId, visibility: 'PRIVATE' } });
        return { ok: response.ok(), status: response.status() };
      });
    }
  } finally {
    await context.dispose();
  }
}
