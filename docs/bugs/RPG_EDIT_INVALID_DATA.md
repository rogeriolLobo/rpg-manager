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

- Unit: 99 testes, 99 passando.
- Integração: 31 testes, 31 passando.
- Typecheck (`tsc --noEmit` app + integração): sem erros.
- Lint dos arquivos alterados: sem erros/avisos.
- Build (`vite build`): sucesso.
