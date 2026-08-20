# F-031 — Auditoria de arquitetura zero-cost para VTT realtime

Exigida antes de implementar F-031 (`docs/product/FULL_ROADMAP.md`,
`.claude/CLAUDE.md` §9/§29). Pergunta: é possível sincronizar posição de
tokens, iniciativa/turno e troca de cena "em tempo real" entre GM e
jogadores sem sair da política Zero Cost (Cloudflare Workers Free)?

## CORREÇÃO (2026-08-20) — a versão anterior deste documento estava errada

A primeira versão desta auditoria concluiu que Durable Objects "não
existem no plano Free" e por isso implementou F-031 como polling de 3s.
**Essa premissa estava desatualizada e foi corrigida**: verificado
diretamente contra a documentação oficial da Cloudflare em vigor nesta
data —

> "Durable Objects are available both on Workers Free and Workers Paid
> plans." — Workers Free plan: apenas Durable Objects com **SQLite
> storage backend** estão disponíveis (o backend key-value é exclusivo
> do plano pago).

WebSocket também é suportado no Free: "There is no charge for outgoing
WebSocket messages." Overage no Free plan **não gera cobrança
automática** — a conta simplesmente recebe erro (1027) até o próximo
reset diário, exatamente o padrão "falhar/degradar em vez de cobrar"
exigido por `CLAUDE.md` §9. Nada nesta arquitetura exige cartão,
upgrade de plano ou billing habilitado.

Reabrindo F-031 como `IN_PROGRESS` → implementado nesta sessão como
realtime real via Durable Object + WebSocket, com o polling da versão
anterior preservado como fallback (não descartado).

## Limites reais do Free plan (verificados, não assumidos)

**Workers Free:**
- 100.000 requests/dia (reset à meia-noite UTC); exceder retorna erro
  1027, nunca cobrança automática.
- 10ms CPU por invocação HTTP padrão.

**Durable Objects (Free — SQLite-backed):**
- Até 100 classes de Durable Object por conta.
- 5 GB de storage por conta / 10 GB por Durable Object.
- 30s de CPU por request (default) dentro do próprio Durable Object.
- Mensagem WebSocket recebida: até 32 MiB.
- Até 6 conexões de saída simultâneas por request.
- Soft limit de 1.000 requests/segundo por instância de Durable Object.
- SQL: até 100 colunas/tabela, 2 MB por linha/BLOB/string, 100 KB por
  statement, 100 parâmetros vinculados por query.

Nenhum desses limites é um risco de custo — são tetos técnicos que, se
excedidos, falham de forma controlada (não há "estourar e ser cobrado"
em Durable Objects/Workers Free). Uma mesa de RPG real (1 GM + poucos
jogadores, updates medidos em segundos, não em milissegundos) fica
ordens de grandeza abaixo de qualquer um desses limites.

## Arquitetura implementada

**Um Durable Object por Campaign** (`VttRoomDO`, `idFromName(campaignId)`)
— granularidade de Campaign (não de Scene, que muda dentro da mesma
mesa) e não de World (VTT já é escopado a Campaign desde F-029,
diferente de Cartografia).

**D1 continua sendo o único estado persistente autoritativo.** O
Durable Object NUNCA duplica dado de domínio (scenes/tokens/combatants
continuam só em D1, via as mesmas rotas REST já existentes e
testadas). O Durable Object guarda só o estado efêmero de coordenação:
conexões WebSocket abertas (com `role`/`userId` resolvidos no
handshake, nunca informados pelo client) e um contador de sequência
(`ctx.storage`, SQLite-backed, sobrevive a hibernação do DO). Isso
evita duas fontes de verdade (`CLAUDE.md`/pedido, seção 4): quando uma
rota REST já existente muda algo (mover token, revelar fog, avançar
turno), a MESMA rota, depois de escrever em D1 com sucesso, notifica o
Durable Object da Campaign; o Durable Object então relê o estado atual
do D1 (reaproveitando as MESMAS funções que já montam o payload de
`GET /live`) e retransmite a cada conexão aberta, filtrado por papel —
GM recebe a visão completa (mesma de `GET /scenes/:id`), jogador recebe
exatamente a mesma visão filtrada que `GET /live` já entregava (nunca
HP, nunca `entityId`/`entityName` de token oculto, nunca célula de fog
não revelada — a MESMA barreira de segurança, nunca uma nova).

**Protocolo tipado e versionado** (`src/domain/vtt-realtime.ts`,
compartilhado entre client e server): `HELLO`, `STATE` (com `reason`
semântico: `SNAPSHOT`/`SCENE_CHANGED`/`TOKEN_MOVED`/`FOG_CHANGED`/
`COMBAT_UPDATED`, sempre carregando o estado ATUAL completo, nunca um
diff parcial — ver justificativa abaixo), `RESYNC_REQUIRED`, `PONG` do
servidor; `PING`/`RESYNC` do cliente.

**Por que snapshot completo em vez de diff por campo:** o pedido desta
correção prioriza "estado atual correto" sobre "event sourcing
completo" (seção 9). Um protocolo de diffs por campo (`TOKEN_MOVED`
carregando só `{id,x,y}`) exigiria o cliente já ter um estado prévio
consistente para aplicar o diff em cima — exatamente o problema que
reconexão/resync tenta evitar. Com snapshot completo a cada evento, um
cliente que perdeu mensagens (rede instável, hibernação do DO) nunca
fica com estado inconsistente: a PRÓXIMA mensagem que chegar já é
autocontida. O campo `reason` preserva o valor semântico (permite ao
frontend decidir uma transição visual diferente por tipo de evento)
sem pagar o custo de correção de diffs parciais.

**Autenticação do WebSocket:** o handshake chega como uma requisição
HTTP normal (`GET /api/v1/vtt/:campaignId/realtime` com
`Upgrade: websocket`) — cookies same-origin são enviados pelo browser
normalmente (diferente de `page.request` do Playwright, que não simula
isso). A rota valida sessão (`requireAuth`, já aplicado a todo
`/api/v1/*`) e authorization de Campaign (dono OU
`campaign_members.user_id` ativo — MESMA checagem já usada por
`GET /live`) **antes** de encaminhar o upgrade ao Durable Object; o
papel (`GM`/`PLAYER`) é resolvido no servidor e anexado à conexão —
nunca aceito do client. Não-membro nunca chega a fazer upgrade (404,
mesmo padrão anti-enumeração do resto do produto).

**Reconexão:** ao abrir, o Durable Object manda `HELLO{sequence}` +
`STATE{reason:'SNAPSHOT', payload atual}` imediatamente — nunca exige
replay de mensagens perdidas. Um client que perceber um gap na
sequência manda `RESYNC` e recebe um novo snapshot completo na hora.

**Fallback:** `VttLivePage` tenta WebSocket primeiro; se falhar (rede
bloqueia upgrade, DO temporariamente indisponível) ou desconectar, cai
de volta no polling de 3s já existente (não removido) enquanto tenta
reconectar o WebSocket periodicamente em segundo plano. Nunca os dois
mecanismos ativos ao mesmo tempo de forma permanente — polling só
enquanto o WebSocket não está conectado.

## O que fica de fora desta v1 (documentado, não escondido)

- **Handout reveal via realtime**: o domínio de handout revelável ao
  jogador ainda não existe no produto (Adventure handouts são
  owner-only até F-033 avaliar visibilidade ao jogador) — o evento
  `HANDOUT_REVEALED` fica reservado no protocolo, não implementado
  ainda, sem consumidor.
- **Múltiplos Game Masters simultâneos escrevendo ao mesmo tempo**:
  continua fora de escopo (VTT é owner-only para escrita, mesmo modelo
  do resto do produto — não mudou nesta correção).
- **Load test formal de "quantas mesas simultâneas cabem no Free"**:
  documentado como estimativa (ver seção correspondente do relatório
  final), não uma simulação de carga real formal.

## Implementação real — achados do desenvolvimento (2026-08-20)

A arquitetura acima foi implementada e testada de ponta a ponta (integração
via `@cloudflare/vitest-pool-workers`, 21 testes cobrindo todos os cenários
da seção 12 do pedido de correção, e E2E via Playwright com dois contextos
de browser reais). Três problemas concretos apareceram durante a
implementação e foram corrigidos — registrados aqui porque nenhum deles
era óbvio a partir do desenho original:

1. **Resposta 101 tem headers imutáveis.** O middleware global (`src/server/index.ts`)
   tentava escrever `X-Request-Id`/security headers em toda resposta,
   inclusive a de upgrade de WebSocket — a Cloudflare marca os headers de
   uma resposta `status:101` como imutáveis, e a tentativa de escrita
   derrubava a conexão com `Can't modify immutable headers.`. Corrigido
   pulando essa escrita quando `c.res.status===101`.
2. **Reconstruir a Request com uma URL diferente quebra o handshake em
   browser real.** A primeira versão da rota de upgrade codificava
   `role`/`userId`/`campaignId` como query string de uma URL nova
   (`new Request(outraUrl, c.req.raw)`) antes de encaminhar ao Durable
   Object. Isso funcionava com um client WebSocket puro (Node `ws`) e nos
   testes de integração, mas travava silenciosamente em Chromium real (o
   WebSocket ficava para sempre em `CONNECTING`, sem `open` nem `error`).
   Corrigido preservando a URL ORIGINAL da requisição e passando os
   metadados por headers (copiados para um `Headers` novo e mutável, já
   que os headers da requisição recebida também são imutáveis).
3. **A primeira mensagem do servidor pode se perder entre o upgrade e o
   client terminar de se inscrever nos listeners** — observado
   especificamente através do proxy de desenvolvimento local
   (`@cloudflare/vite-plugin`/Miniflare), não nos testes de integração.
   Mitigado no client: ao abrir a conexão, além de aguardar o `HELLO`/
   `STATE` não solicitados, o `VttLivePage` manda um `RESYNC` ativamente —
   nunca faz mal (o protocolo já é resiliente a `STATE` duplicado via
   `sequence`) e garante convergência mesmo se a primeira mensagem
   push se perder. A conexão inicial também é adiada com
   `setTimeout(connect,0)` para nunca criar um WebSocket descartável
   durante o mount→cleanup→remount do React StrictMode (dev only).

**Nota de ambiente:** o sandbox usado nesta sessão mostrou latência local
alta e variável para o runtime de Durable Object do `wrangler dev`/
`@cloudflare/vite-plugin` (dezenas de execuções consecutivas de teste ao
longo da investigação, possivelmente com contenção acumulada de recursos)
— os testes E2E de realtime (`tests/e2e/vtt-live.spec.ts`,
`tests/e2e/vtt-realtime.spec.ts`) usam timeouts mais folgados que o padrão
do projeto por isso, com justificativa em comentário. O mecanismo em si foi
comprovado correto de ponta a ponta em múltiplas execuções completas nesse
mesmo sandbox (WebSocket abre, `HELLO`/`STATE`/`COMBAT_UPDATED` chegam,
UI atualiza sem reload) — a variável foi sempre tempo de espera, nunca
comportamento incorreto.

## Evidência real de conta (2026-08-20)

`wrangler deploy` (produção real, não `--dry-run`) resolveu o binding
`env.VTT_ROOMS (VttRoomDO) Durable Object` sem qualquer erro, sem
prompt de billing, sem exigir cartão ou upgrade de plano — a conta
Cloudflare real deste projeto aceitou a classe de Durable Object
SQLite-backed no Workers Free, confirmando na prática (não só na
documentação) a premissa corrigida desta auditoria. Deploy completo:
Worker Version ID `e792a8b9-ca6c-4246-ac7e-0ec4b3751360`,
`/api/v1/version` confirma `commit:"ebfc528"` em produção.

O handshake de WebSocket autenticado completo contra produção
(registrar conta → criar campanha/cena → conectar `wss://` →
confirmar `HELLO`/`STATE`) não pôde ser automatizado nesta sessão: o
registro de conta em produção é protegido por Turnstile, e por
`CLAUDE.md` §39 este projeto não tenta bypass/evasão de CAPTCHA.
**MANUAL_SMOKE_REQUIRED** — passos mínimos para quem tiver acesso
humano ao formulário de registro:

1. Registrar uma conta em https://rpg-manager.editorahuginnemuninn.workers.dev/register.
2. Criar um RPG, uma Campanha, uma Cena em `/app/campaigns/:id/vtt`, ativá-la.
3. Abrir `/app/campaigns/:id/vtt/live` (visão do jogador) — confirmar
   que o badge "● Tempo real" aparece (prova que o WebSocket conectou
   ao Durable Object real) e que mover um token/iniciar combate no
   console do GM aparece na visão do jogador sem reload manual.

Isso é o único passo de verificação que depende de interação humana —
tudo o que podia ser comprovado sem CAPTCHA já foi (deploy real da
conta aceitando o binding, CI verde com E2E completo num runner
dedicado, 21 testes de integração cobrindo os mesmos cenários contra
o runtime real de Durable Object do `vitest-pool-workers`).

## Conclusão

F-031 = Durable Object (`VttRoomDO`, SQLite-backed, Free plan) +
WebSocket real, com D1 como única fonte de verdade e polling como
fallback controlado — não substituído, preservado. `DONE` de verdade
desta vez, com evidência real de deploy em produção (ver relatório da
sessão para Worker Version ID e prova da migration de Durable Objects).
