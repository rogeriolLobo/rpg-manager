# Bug: "Dados inválidos." ao editar RPG existente

## Sintoma

Ao abrir um RPG existente na Biblioteca e salvar (com ou sem alterações), o
formulário exibia apenas a mensagem genérica **"Dados inválidos."**, sem
indicar qual campo era o responsável.

## Causa raiz

O campo `coverUrl` do RPG era revalidado **por completo em toda edição**,
mesmo quando o valor não era alterado pelo usuário:

1. O schema Zod [`rpgInputSchema`](../../src/shared/validation/schemas.ts)
   aplicava, no próprio schema de entrada, um `refine(isAllowedCoverUrl, …)`
   que só aceita `coverUrl` cujo host esteja numa allowlist fixa
   (`covers.openlibrary.org`, `cdn11.bigcommerce.com`, etc. — ver
   [`cover-url.ts`](../../src/shared/security/cover-url.ts)).
2. A rota `PATCH /rpgs/:id` ([`rpgs.ts`](../../src/server/routes/rpgs.ts))
   reenviava o `coverUrl` já persistido dentro do payload de atualização (o
   formulário carrega o RPG via `GET` e reenvia todos os campos no `submit`,
   incluindo os que não mudaram).
3. RPGs legados/importados possuem `cover_url` apontando para hosts que
   **não estão** na allowlist atual (ex.: uma miniatura do Google
   Shopping/`encrypted-tbn2.gstatic.com`, provavelmente gravada antes da
   allowlist existir ou por outra via). Ao reabrir esse RPG e salvar, o
   próprio valor antigo, sem nenhuma alteração, era rejeitado pelo schema
   com `422 VALIDATION_ERROR` → **"Dados inválidos."**

Em outras palavras: a rota tratava a edição como se fosse sempre uma
submissão nova de `coverUrl`, aplicando a mesma regra de allowlist +
verificação remota (SSRF) tanto para criação quanto para edição — mesmo
quando o campo não mudou.

## Campo responsável

- **Campo:** `coverUrl`
- **Valor recebido (exemplo real):**
  `https://encrypted-tbn2.gstatic.com/shopping?q=tbn:...`
- **Regra anterior:** `rpgInputSchema.coverUrl` exigia
  `isAllowedCoverUrl(value)` (host precisa estar em `COVER_IMAGE_HOSTS`)
  **em toda submissão**, criação ou edição.
- **Afetava todos os RPGs?** Não — apenas RPGs (tipicamente legados/
  importados) cujo `cover_url` já persistido não está na allowlist atual.
  RPGs sem capa ou com capa de host permitido eram editáveis normalmente.
- **Registros importados envolvidos?** Sim — é o cenário mais provável
  (capas coletadas manualmente/por fontes diversas antes da allowlist
  atual existir).
- **Campos vazios envolvidos?** Não nesse caso específico — o problema
  ocorre com um valor de `coverUrl` preenchido, mas fora da allowlist.

## Correção

### Schema (`src/shared/validation/schemas.ts`)

O `coverUrl` no schema de entrada passou a validar apenas a **forma** da
URL (HTTPS pública, sem credenciais/porta, sem IP privado/loopback —
`isPublicHttpsUrl`), e não mais a allowlist de hosts. Isso mantém o
bloqueio de protocolos perigosos (`javascript:`, `data:`, `file:`, `ftp:`)
e de hosts privados/SSRF já na camada de schema, sem impedir a edição de
registros legados.

### Rota (`src/server/routes/rpgs.ts`)

A allowlist de hosts + a verificação remota da imagem (fetch com proteção
contra SSRF, feita em `validateCoverImage`/`validateRemoteCoverImage`)
continuam sendo aplicadas, mas agora **somente quando o valor de `coverUrl`
é novo ou muda em relação ao que já está persistido**:

- `POST /rpgs` (criação): `coverUrl` é sempre novo → sempre validado.
- `PATCH /rpgs/:id` (edição): a rota agora busca o `cover_url` atual antes
  de aplicar a regra; se o valor enviado for igual ao persistido, a
  allowlist e o fetch remoto são pulados. Se for diferente (usuário
  colocou uma capa nova), a validação completa (allowlist + fetch) roda
  normalmente.

Isso resolve exatamente a distinção pedida: a URL já persistida só é usada
pelo navegador como `<img src>` ao reabrir o formulário — o servidor não
precisa buscá-la de novo nem revalidar seu host a cada `save` sem mudança.
Uma URL nova (potencial vetor de SSRF) continua sendo integralmente
validada.

Ao validar o smoke autenticado, foi encontrada uma lacuna adicional:
`validateCoverImage` (rejeição de capa nova fora da allowlist/SSRF) lançava
um `ApiError` **sem** o campo `fields`, então o frontend só mostrava a
mensagem genérica no topo, não o erro junto ao campo `URL da capa`. Corrigido
passando `{ coverUrl: [result.message] }` como `fields` nesse `ApiError`,
alinhando esse caminho de erro (validado na rota) com o caminho de erro do
schema Zod (que já populava `fields` via `parsed.error.flatten().fieldErrors`).
Teste de integração atualizado para cobrir isso.

### Compatibilidade

- O importador de CSV ([`transfer.ts`](../../src/server/routes/transfer.ts))
  já fazia sua própria checagem `isAllowedCoverUrl` independente do schema
  (linha `if(coverUrl&&!isAllowedCoverUrl(coverUrl))rowIssues.push(...)`)
  — continua funcionando sem alteração.
- Nenhuma migration, dado ou capa existente foi alterado. O `cover_url`
  legado é preservado como está; apenas deixou de bloquear a edição dos
  demais campos do RPG.

### Tratamento de erro (frontend)

O backend já retornava `fields` estruturado em erros de validação
(`{ error: { code, message, fields } }`, ver
[`http.ts`](../../src/server/http.ts) e [`index.ts`](../../src/server/index.ts))
e o `ClientApiError` do frontend já carregava esse campo — mas a tela de
edição de RPG ([`library-pages.tsx`](../../src/client/pages/library-pages.tsx))
ainda exibia apenas a mensagem genérica. Agora, quando a API retorna
`fields`, cada campo relevante (`title`, `coverUrl`, `isbn`,
`coverSourceUrl`, `coverSourceNote`, `plannedPlayDate`) mostra sua própria
mensagem de erro logo abaixo do input, usando os tokens de cor
`--danger`/`--danger-background` já existentes (funciona em light/dark sem
cor fixa). O erro genérico no topo passa a dizer "Revise os campos
destacados." quando há erros de campo específicos.

## Testes adicionados

### Unitários (`tests/unit/validation.test.ts`)

- Edição sem alteração com todos os campos opcionais como `null`.
- Edição sem alteração com todos os campos opcionais como `""`.
- `plannedPlayDate` vazio, nulo e ISO válido.
- **Regressão principal:** `coverUrl` de host legado
  (`encrypted-tbn2.gstatic.com`) fora da allowlist é aceito pelo schema.
- `coverUrl` com protocolo perigoso (`javascript:`, `data:`, `ftp:`) ou IP
  privado continua rejeitado.
- ISBN vazio, nulo, com e sem hífen.
- Cover metadata parcial (`coverUrl` preenchido, demais campos de capa
  nulos).

Confirmado que o teste de regressão **falha no código anterior** (422 em
vez de sucesso) e **passa após a correção** — verificado revertendo
temporariamente `schemas.ts`/`rpgs.ts` via `git stash` e reexecutando.

### Integração (`tests/integration/auth-and-isolation.test.ts`)

Novo teste: `permite editar RPG legado sem alterar capa fora da allowlist
atual de hosts`. Fluxo completo:

1. Cria RPG e força, via SQL direto, um `cover_url` legado fora da
   allowlist (simulando dado real de produção/import).
2. `GET /rpgs/:id` (READ MODEL usado pelo formulário).
3. `PATCH /rpgs/:id` reenviando exatamente o mesmo payload (sem alteração)
   → espera `200`, capa preservada.
4. `PATCH` alterando apenas `wantsToPlay` → espera `200`, capa preservada.
5. `PATCH` trocando `coverUrl` para um host **novo** fora da allowlist →
   espera `422 INVALID_COVER_IMAGE` (garante que a proteção contra SSRF
   continua ativa para valores realmente novos).

Confirmado que esse teste **falha no código anterior** (`422` no passo 3)
e **passa após a correção**.

## Resultado das validações

- Unit: 99 testes, 99 passando (66 do escopo do fix + navigation-invariants
  local não commitado; ver seção de deploy para a contagem exata do commit
  publicado).
- Integração: 31 testes, 31 passando.
- Typecheck (`tsc --noEmit` app + integração): sem erros.
- Lint dos arquivos alterados: sem erros/avisos.
- Build (`vite build`): sucesso.

## Commit, CI e deploy

Foram dois commits em `main`, escopados apenas aos arquivos deste fix
(sem tocar no trabalho de navegação já em andamento, mas ainda não
commitado nesta árvore — item fora de escopo desta tarefa):

1. `d5b0d70` — `fix(library): preserve legacy cover URLs when editing RPGs`
   (correção principal: schema + rota + UI de erros por campo).
2. `ebff759` — `fix(library): surface field-level error for rejected cover
   URLs` (gap encontrado durante o smoke: `validateCoverImage` não
   populava `fields` no `ApiError`, então a rejeição de uma capa nova
   fora da allowlist só aparecia como mensagem genérica).

CI (GitHub Actions, workflow `ci.yml`, lint → typecheck → unit →
integration → build → Playwright install → E2E chromium+mobile-chromium):

- Run do commit `d5b0d70`: falhou uma vez por timeout de asserção em
  `core-flow.spec.ts` (não relacionado a este fix — reproduzido 6/6 vezes
  localmente no commit exato sem falha); re-executado (`gh run rerun
  --failed`) e ficou 100% verde.
- Run do commit `ebff759`: 100% verde na primeira tentativa.

Antes de cada deploy, o gate completo (lint, typecheck, unit, integration,
build, E2E desktop+mobile) foi reexecutado localmente em um **git worktree
limpo no commit exato que seria publicado** (sem as alterações de
navegação ainda não commitadas nesta árvore), para garantir que o que
seria publicado era exatamente o que passou no CI.

Deploy (`wrangler deploy`, a partir do commit exato, sem nenhuma
alteração não commitada de outras tarefas):

- 1ª publicação: commit `d5b0d70`, Version ID `b6de8ae8-fdc5-4c16-b082-b285e2116aa8`.
- 2ª publicação (após o gap de `fields` ser corrigido): commit `ebff759`,
  Version ID `1366dcf1-621a-4072-b0d3-e96d84fd53d3` (versão final em
  produção).
- URL: `https://rpg-manager.editorahuginnemuninn.workers.dev`

## Smoke de produção

Verificação somente-leitura no D1 de produção (`wrangler d1 execute
--remote`), sem nenhum `INSERT`/`UPDATE`/`DELETE`:

- Total de RPGs: 29 → 30 entre as duas checagens (o novo registro,
  "Street Fighter", foi criado às 16:40:51 UTC pelo próprio usuário
  usando o app em produção durante a janela de deploy — confirmado pelo
  horário e por não haver nenhuma escrita minha no D1 remoto além das
  consultas `SELECT`). Os 27 RPGs com `cover_url` preenchido
  permaneceram intactos; nenhuma capa, nota ou campo foi alterado.
- Nenhum dos 27 `cover_url` atualmente persistidos aponta para um host
  fora da allowlist atual — ou seja, o exemplo literal do ticket
  (`encrypted-tbn2.gstatic.com`) não corresponde a nenhum registro
  persistido hoje. A causa raiz e a correção continuam válidas (o
  mecanismo foi reproduzido e comprovado via teste automatizado com uma
  capa forçada via SQL, exatamente como um registro legado real teria).

Smoke autenticado via clique real na UI (login → abrir RPG → Editar →
não alterar → Salvar; capa nova rejeitada com erro no campo) **não foi
concluído por mim**: o registro de conta em produção exige Turnstile
(proteção anti-bot real), e uma tentativa honesta com navegador Chromium
real (não headless, sem qualquer técnica de evasão) foi bloqueada com
"Não foi possível validar a proteção contra bots." — a proteção
funcionando corretamente contra automação. Não tentei contornar essa
proteção. Fica como passo manual pendente para o usuário (checklist no
relatório final da conversa).

## Segundo achado do smoke manual — client-side legacy URL "vazando" entre RPGs

O usuário rodou o smoke manual pedido e reproduziu, em produção, a
mensagem "A URL da capa deve usar HTTPS e um domínio de imagens
autorizado." ao editar um RPG que ele descreveu como já tendo
`coverUrl = https://devir.com.br/...` persistida.

**Origem exata da mensagem:** `src/server/security/cover-images.ts:12`,
dentro de `validateRemoteCoverImage`, chamada por `validateCoverImage` em
`src/server/routes/rpgs.ts`. É sempre o backend quem produz essa string —
não existe validação de allowlist de hosts no frontend nem duplicada em
outro lugar.

**Investigação:** consulta somente-leitura ao D1 de produção
(`SELECT ... WHERE cover_url LIKE '%devir%'` e listagem completa dos 27
`cover_url` não nulos) não encontrou nenhum registro com domínio
`devir.com.br` — nem nenhum host fora da allowlist atual. A regra
CASO A/B/C (schema + `shouldRevalidateCoverUrl` em
`src/server/routes/rpgs.ts`) estava correta e permanece correta; o valor
citado pelo usuário nunca chegou a ser persistido (o `PATCH` foi
rejeitado, exatamente como o desenho pretende para uma capa **nova** fora
da allowlist).

**Causa raiz real, confirmada lendo o código:** `RpgFormPage`
(`src/client/pages/library-pages.tsx`) carregava os dados do RPG num
`useEffect` que dependia de `[id]`, mas:

1. não resetava `form` ao trocar de `id` (nem ao ir de "Editar" para
   "Novo RPG", nem entre editar RPGs diferentes);
2. não tinha guard de cancelamento — uma resposta antiga e lenta do
   `GET /rpgs/:id` podia resolver **depois** de o usuário já ter navegado
   para outro RPG, sobrescrevendo o formulário certo com dados errados.

Ou seja: era possível o formulário mostrar (e o usuário acreditar estar
"já persistido") um valor de `coverUrl` que na verdade veio de uma tela
anterior — nunca gravado para aquele RPG específico. O checklist de smoke
que fornecemos ao usuário orienta explicitamente testar "trocar a URL da
capa para um host não autorizado" logo depois de outras edições, cenário
em que esse vazamento de estado é fácil de acontecer sem o usuário
perceber.

### Por que os testes anteriores não pegaram isso

- Os testes unitários e de integração anteriores exercitavam a **API**
  diretamente (`request(...)`), nunca o formulário React de verdade —
  não havia como capturar um bug de estado do componente.
- O E2E existente (`core-flow.spec.ts`) cria um RPG novo uma única vez e
  nunca reabre o formulário de edição de dois RPGs diferentes em
  sequência — não exercitava a troca de contexto que expõe o bug.
- Nenhuma fixture usava um host histórico como `devir.com.br` já
  persistido para um RPG que o smoke reabriria depois de editar outro.

### Correção

**Frontend** (`src/client/pages/library-pages.tsx`):

- `RpgFormPage` agora é só um wrapper fino que lê `id` de `useParams()` e
  renderiza `<RpgFormFields key={id ?? "__new__"} id={id} />`. A `key`
  força o React a **desmontar e remontar** o formulário sempre que o RPG
  (ou o modo editar/novo) muda — o padrão idiomático do React para "reset
  completo de estado quando um identificador muda", em vez de resetar
  manualmente dentro de um efeito.
- `RpgFormFields` mantém um guard `active` no `useEffect` (cancela a
  atualização de estado se o componente for desmontado antes da resposta
  chegar) e inicializa `loading` via `useState(Boolean(id))`.
- Novo `<fieldset className="rpg-form-fields" disabled={loading}>`
  envolvendo todos os campos: enquanto os dados reais do RPG ainda não
  chegaram, os campos ficam bloqueados — isso fecha uma janela de corrida
  que o próprio guard `active` sozinho não cobria (o usuário digitar algo
  antes do `GET` resolver, e a resposta do `GET` sobrescrever o que foi
  digitado). CSS `display: contents` no fieldset preserva o layout de
  grid existente.

**Backend** (`src/server/routes/rpgs.ts`): a regra de comparação CASO
A/B/C foi extraída para uma função pura e testável,
`shouldRevalidateCoverUrl` (`src/domain/rpg/cover-policy.ts`), usada no
`PATCH`. Nenhuma mudança de comportamento — só tornou a regra
explicitamente nomeada e testável isoladamente.

**Importer** (`src/server/routes/transfer.ts`): auditoria encontrou uma
inconsistência real (não relacionada ao formulário, mas ao mesmo domínio
de regra): a checagem de allowlist (`isAllowedCoverUrl`) rodava para
**qualquer** linha do CSV com `coverUrl`, mesmo quando o RPG já existia
com capa própria e a linha seria classificada `IGNORADO` (capa
preservada, nunca escrita). Isso significa que reexportar o catálogo
atual para CSV e reimportar podia reprovar linhas cuja capa nem seria
alterada. Corrigido: a checagem de allowlist só roda quando a capa do CSV
realmente seria usada para gravar um valor novo (RPG novo, ou RPG
existente ainda sem capa) — mesma condição que já protegia a verificação
remota (fetch) alguns parágrafos abaixo no mesmo arquivo.

### Testes novos

- `tests/unit/cover-policy.test.ts`: 9 casos cobrindo `CASO A/B/C`
  isoladamente (sem alteração, mesmo valor, editado-e-revertido,
  removida, trocada para host proibido, trocada para host permitido,
  CREATE com/sem capa), usando `devir.com.br` como fixture real.
- `tests/unit/validation.test.ts`: caso adicional confirmando que o
  schema aceita a forma de URL da Devir (shape apenas, não allowlist).
- `tests/integration/auth-and-isolation.test.ts`: novo teste
  `"aplica CASO A/B/C de coverUrl com fixture real (devir.com.br)"`
  cobrindo CREATE rejeitado, edição sem alteração, edição revertida,
  troca para host proibido (capa antiga preservada), troca para host
  permitido (aceita), remoção da capa (normaliza para `null`); e novo
  teste `"importer não reprova CSV com capa legada já preservada"`
  reproduzindo e corrigindo o gap do importer.
- `tests/e2e/rpg-cover-edit.spec.ts`: fluxo completo pela UI real —
  cria dois RPGs, edita o primeiro sem salvar, navega direto para o
  segundo e confirma que nenhum dado do primeiro vazou; edita o segundo
  sem alterar nada e salva com sucesso; troca a capa para um host
  proibido e confirma o erro exibido junto ao campo "URL da capa".

Confirmado que o teste do importer **falha no código anterior**
(`ERRO` em vez de `IGNORADO`) e passa após a correção (verificado via
`git stash` temporário, igual ao procedimento do achado anterior). O
teste E2E, antes da correção do `RpgFormPage`, reproduziu o vazamento de
estado (a capa proibida digitada era descartada silenciosamente pela
resposta tardia do `GET`, fazendo o `PATCH` ser enviado sem alteração
real e o teste falhar na asserção do erro de campo).

**Confirmação explícita:** `devir.com.br` **não** foi adicionada à
allowlist de hosts em nenhum momento. A allowlist (`COVER_IMAGE_HOSTS`
em `src/shared/security/cover-url.ts`) permanece inalterada.
