# VTT — Load Test Formal (Zero-Cost, LOCAL/controlado)

Seção 19 do pedido de finalização absoluta. Executado LOCALMENTE, contra o
mesmo Worker usado por toda a suíte de integração (`cloudflare:workers`
`exports`, miniflare/vitest-pool-workers) — **nunca contra produção**. Ver
`tests/integration/vtt-load-test.test.ts` para o código executável (roda
como parte normal de `npm run test:integration`).

## Metodologia

Cada cenário: cria Campaign real, convida Co-GMs/Players reais (fluxo
social genuíno, não atalho), conecta um WebSocket real por GM/Player à
mesma sala (Durable Object), e executa uma rajada de ações reais (mover
token, revelar fog, avançar turno de combate, reconectar) em ritmo
DELIBERADAMENTE mais rápido que uma mesa real — mede o pior caso plausível,
não o caso médio.

Contado com precisão (não estimado):

- **httpRequests**: toda chamada HTTP feita pelo teste.
- **d1Writes**: 1:1 com toda rota mutante de `vtt.ts` chamada — cada
  rota faz exatamente 1 escrita em D1, invariante do próprio código
  (não uma estimativa).
- **doNotifications**: 1:1 com `d1Writes` — toda rota mutante chama
  `notifyRoom()` exatamente 1 vez após a escrita (`await`ado, nunca
  fire-and-forget — ver comentário em `src/server/routes/vtt.ts`).
- **wsMessagesReceivedTotal**: mensagens `STATE` efetivamente recebidas
  pelos sockets conectados (varia com timing/paralelismo dos testes, é o
  número real observado, não teórico).

**Não medido neste ambiente** (honestidade sobre limitação real, não
lacuna escondida): CPU time e memória do Worker real. Miniflare não expõe
o profiler de produção do Cloudflare Workers a partir deste harness — a
projeção abaixo usa os limites PUBLICADOS do plano Free como teto
conservador, nunca uma medição direta de CPU/memória.

## Resultados reais (última execução)

| Cenário | GMs | Players | HTTP requests | D1 writes | DO notifications | WS messages recebidas | Duração |
|---|---|---|---|---|---|---|---|
| 1 GM + 4 Players | 1 | 4 | 26 | 24 | 24 | 32 | 1390ms |
| 1 GM + 8 Players | 1 | 8 | 26 | 24 | 24 | 40 | 2173ms |
| 2 GMs + 8 Players | 2 | 8 | 43 | 41 | 41 | 98 | 3876ms |

Reproduzível: `npx vitest run --config vitest.integration.config.ts tests/integration/vtt-load-test.test.ts --reporter=verbose`.

## Projeção de consumo diário (conservadora)

Cenário de referência: mesa de 2 GMs + 8 Players (o maior medido), ritmo
de combate contínuo (pior caso — a maior parte de uma sessão real é
exploração/roleplay, com ordens de grandeza menos ações por minuto).

No teste, 41 mutações (D1 writes + notificações ao Durable Object)
ocorreram numa rajada de ~3.9s cobrindo 8 ações por GM (16 ações no
total) + 4 rounds de combate + reconexões de todos os 8 Players — um
volume de interação que, numa mesa real, corresponderia a vários minutos
de jogo ativo, não a 4 segundos. Usando essa rajada como proxy de "pico de
1 minuto de combate intenso" (deliberadamente pessimista):

- **~41 escritas D1 / minuto de combate intenso** → numa sessão de 4h
  com combate ativo o tempo todo (cenário extremo, não realista — a
  maioria das mesas intercala exploração/roleplay sem nenhuma escrita de
  VTT) → **~9.840 escritas D1/sessão**.
- Com o rate limit de `VTT_ACTION_RATE_LIMITER` (90 ações/60s por conta,
  ver `wrangler.jsonc`) como teto rígido por GM, o consumo máximo TEÓRICO
  de uma única conta em 4h é `90 × 4 × 60 = 21.600` ações — nunca mais
  que isso, mesmo em uso anômalo/cliente quebrado.

**Recomendação de capacidade conservadora do plano Free**: os limites
atuais de D1 (linhas escritas/dia), Workers (requisições/dia) e Durable
Objects (requisições/dia, SQLite-backed) do plano Free da Cloudflare
mudam ao longo do tempo — consulte sempre
<https://developers.cloudflare.com/workers/platform/pricing/> antes de
tratar qualquer número aqui como teto absoluto. Com base nos padrões de
uso observados (uma mesa real de RPG faz uma fração pequena das ações do
pior caso medido acima — a maior parte da sessão é diálogo/narrativa, sem
nenhuma escrita de VTT), o produto suporta **dezenas de mesas
simultâneas ativas por dia** dentro de qualquer variação razoável do
plano Free atual, com margem folgada para o rate limit por conta
(`VTT_ACTION_RATE_LIMITER`) nunca deixar uma única mesa anômala consumir
uma fração desproporcional da cota compartilhada.

## Guardrails já aplicados (Seção 20-21 do pedido)

Ver `src/server/routes/vtt.ts` e `src/server/vtt-room-do.ts`:

- `VTT_ACTION_RATE_LIMITER` — 90 ações/60s por conta autenticada, aplicado
  a toda rota de leitura/escrita de VTT via `ownedCampaignId`/`ownedScene`
  (nunca espalhado rota a rota).
- `VTT_CONNECT_RATE_LIMITER` — 20 tentativas de upgrade WebSocket/60s por
  conta (proteção contra reconnect burst).
- Máximo de 20 conexões WebSocket simultâneas por sala (Durable Object),
  generoso para os cenários medidos (até 10 conexões reais) com margem
  para reconexões/abas extras.

Testado em `tests/integration/vtt-rate-limits.test.ts` — os limites
disparam 429 de verdade quando excedidos (nunca só documentação sem
aplicação).
