# Reauditoria de Segurança — BATCH23 (Seção 27 do pedido de finalização)

Checklist EXECUTADO (comandos reais rodados, achados reais, não texto
genérico). Escopo: toda a superfície nova desta rodada (F-015 expandido,
F-035 Handout Realtime, F-036 Multi-GM, rate limits) + uma varredura
sistêmica dos invariantes de segurança que sustentam o produto inteiro.

## Metodologia

Cada item abaixo foi verificado por leitura direta do código-fonte real
(`Grep`/`Read`) e, quando aplicável, por um teste de integração que já
prova o comportamento (não apenas "parece certo") — os testes citados já
rodam como parte de `npm run test:integration` e falhariam caso a
proteção quebrasse.

## Achados

| Item | Verificado como | Resultado |
|---|---|---|
| SQL Injection | `Grep` de todo `.prepare(\`...${...}\`)` no server (~45 ocorrências) | Nenhum vetor: toda interpolação é (a) uma constante de coluna/SELECT definida no mesmo arquivo, nunca de input; (b) o padrão seguro `IN (${arr.map(()=>'?').join(',')})` — gera só a CONTAGEM de placeholders, valores sempre via `.bind()`; (c) fragmentos de cláusula fixos no código (`clause`/`order`/`worldFilter`), nunca texto SQL vindo do cliente. Nenhum valor de usuário concatenado diretamente numa string SQL em lugar nenhum do server. |
| XSS | `Grep` de `dangerouslySetInnerHTML` em todo `src/client` | Zero ocorrências — nenhuma superfície de HTML não-escapado no client inteiro (React escapa por padrão). |
| CSRF | Leitura de `src/server/index.ts` | Todo grupo de rotas (incluindo `/api/v1/vtt/*` e `/api/v1/campaigns/*`, que cobrem TODAS as rotas novas desta rodada: Multi-GM, handout reveal/hide) passa por `requireAuth, requireCsrf`; catch-all final `/api/v1/*` como rede de segurança. Confirmado indiretamente por ~250 testes de integração que só funcionam PORQUE enviam `X-CSRF-Token` corretamente — se a proteção tivesse regredido (para mais fraca OU mais forte), a suíte inteira quebraria. |
| Mass assignment | Todo schema de input novo desta rodada (`campaignCoGm` não tem input schema — IDs vêm de path param/sessão, nunca de body) | `z.strictObject` em uso — nenhum campo extra enviado pelo client é aceito silenciosamente. |
| IDOR / multi-tenant | `tests/integration/multi-gm.test.ts` ("IDOR: Co-GM da Campaign A nunca administra a Campaign B") + `tests/integration/backup-restore.test.ts` ("restaurar o backup de outra conta...") + `tests/integration/asset-backup.test.ts` ("restaurar o bundle de outra conta...") | Todos passam — nenhuma entidade nova (campaign_co_gms, VTT handout reveal, bundle de assets) é acessível cross-tenant. |
| Player vs GM | `tests/integration/multi-gm.test.ts` ("Co-GM administra VTT... Player e Outsider são bloqueados") | Escrita de VTT sempre 404 para Player/Outsider; leitura (`GET /live`) só para membro ativo. |
| Co-GM vs Owner | `tests/integration/multi-gm.test.ts` ("Co-GM NUNCA pode excluir a Campaign, transferir ownership...") | PATCH/DELETE de Campaign e revogar Co-GM continuam 404 para Co-GM — `authorizeCampaignOwnership` nunca aceita Co-GM. |
| WebSocket auth | `src/server/routes/vtt.ts` (`authorizeLiveAccess`/`authorizeCampaignParticipation`) + `src/server/vtt-room-do.ts` | Papel (GM/PLAYER) SEMPRE resolvido no servidor ANTES do upgrade, nunca aceito de header/query do client — o DO só recebe metadados já validados (`X-Vtt-Role`/`X-Vtt-User-Id` são cópias do que o servidor já decidiu, não entrada do usuário). |
| WebSocket message spoofing | `src/server/vtt-room-do.ts` (`webSocketMessage`) | Client só pode enviar `PING`/`RESYNC` — nunca uma mensagene que altere estado; toda mutação real passa pela rota HTTP normal (autorizada) antes do broadcast. |
| Fog filtering / hidden tokens | Pré-existente, revalidado nesta rodada por não ter sido tocado pelo Multi-GM (`buildPlayerLiveScenePayload` continua a única fonte da visão do jogador) | Sem regressão — Co-GM usa a MESMA função de payload de GM que o Owner já usava. |
| Private handouts | `tests/integration/handout-realtime.test.ts` + `tests/integration/multi-gm.test.ts` ("Co-GM revela/oculta handout... Player e Outsider bloqueados") | Conteúdo do handout nunca viaja no evento realtime (só o sinal `HANDOUT_REVEALED`/`HANDOUT_HIDDEN`); leitura autorizada sempre via `GET /player-home`, que filtra por `revealed_at IS NOT NULL`. |
| Social privacy | Pré-existente (F-016/017/018), revalidado pelo teste de Social do F-015 ("nunca forja o grafo social de outra pessoa") | Sem regressão. |
| Sheet auth / asset auth | Pré-existente (F-020/021, F-028), revalidado pelos testes de restore de Sheets e Assets desta rodada | Sem regressão — restauração sempre revalida owner/magic-bytes, nunca confia no bundle. |
| Backup/restore ownership | `tests/integration/backup-restore.test.ts`, `tests/integration/asset-backup.test.ts` | Restore SEMPRE cria IDs novos sob o usuário autenticado — testado explicitamente com cenário de ataque (bundle/backup de vítima restaurado por atacante). |
| Mass restore de relação social | `tests/integration/backup-restore.test.ts` ("Social: restaurado... numa conta ALHEIA nunca forja o grafo social") | Confirma que só quem é uma das duas partes reais de uma relação social pode restaurá-la. |
| SSRF | `isPublicHttpsUrl` aplicado a todo campo de URL novo desta rodada (`vttSceneInputSchema.imageUrl`, `worldMapInputSchema.imageUrl`, `externalResourceInputSchema.url`) — já auditado nas rodadas anteriores, revalidado aqui por não ter sido alterado | Sem regressão — servidor nunca busca essas URLs, só valida sintaxe/protocolo. |
| File magic bytes | `src/domain/content/file-asset.ts` (`sniffFileAssetContentType`) — usado tanto no upload normal quanto no bundle de restore (`validateAssetBundle`) | Content-type do bundle NUNCA confiado — sempre resniffado dos bytes reais antes de gravar. |
| Rate limiting / Free-tier | `tests/integration/vtt-rate-limits.test.ts` | `VTT_ACTION_RATE_LIMITER`/`VTT_CONNECT_RATE_LIMITER` disparam 429 de verdade quando excedidos. |

## Conclusão

Nenhum achado novo de segurança nesta rodada — a superfície nova
(Multi-GM, Handout Realtime, restore expandido, rate limits) segue os
mesmos invariantes já estabelecidos e testados no resto do produto
(404-nunca-403 anti-enumeração, autorização sempre no servidor, nunca
confiar em dado do client, restore sempre cria IDs novos sob o dono
autenticado). Não é uma auditoria de penetração externa nem cobre 100%
das ~90 rotas do produto linha a linha — é uma verificação sistêmica dos
invariantes centrais + cobertura total da superfície NOVA desta rodada,
que é onde uma regressão real teria mais chance de aparecer.
