# Diagnóstico de E2E local — este PC (RPG-1.0-BATCH5)

Este documento existe para que a próxima falha de E2E local NUNCA seja
descartada como "flake" sem reprodução — CLAUDE.md e o pedido que originou
este arquivo exigem classificação factual: `PRODUCT_BUG`, `TEST_BUG`,
`ENVIRONMENT_LIMITATION`, `EXPECTED_SECURITY_BLOCK` ou `EXTERNAL_FAILURE`.

## Sintoma

`tests/e2e/release-1.0-smoke.spec.ts` (e ocasionalmente outras specs)
falhavam localmente, quase sempre no primeiro `POST` de escrita real da
suíte (criar RPG), com "elemento não encontrado" depois de 10s — a página
ficava presa em "Carregando grimório…".

## Investigação (evidência real, não suposição)

1. **Hipótese descartada — API/backend incorreto.** `curl` direto contra
   `POST /api/v1/rpgs` (registro → criar RPG → buscar detalhe → listar)
   sempre respondeu corretamente, em ~2s, mesmo com o servidor frio.
   Conclusão: a API está correta; o problema é de timing, não de lógica.

2. **Hipótese descartada — diálogo `confirm()` nativo mal capturado.**
   Reproduzido separadamente (remoção de pin em Cartografia): o `DELETE`
   real funcionava perfeitamente via `curl`. A causa daquele sintoma
   específico era só timing de teste, corrigido esperando a resposta de
   rede real (`page.waitForResponse`) em vez de confiar cegamente no DOM —
   ver `tests/e2e/release-1.0-smoke.spec.ts`.

3. **Hipótese descartada — "D1 frio" (primeira escrita multi-tabela).**
   Um `global-setup.ts` novo (`tests/e2e/global-setup.ts`) foi criado para
   aquecer explicitamente o caminho de escrita mais pesado (registro +
   criar RPG + criar World, o mesmo `D1.batch` multi-tabela de
   `buildCreateLibraryEntryStatements`) antes de qualquer teste rodar, com
   timeout próprio e generoso. O warmup terminou com sucesso total
   (register ~2s, criar RPG ~2.4s, buscar ~2.1s, criar World ~2.9s) — e a
   suíte real **ainda assim falhou no mesmo ponto**. Isso prova que não é
   "primeira execução de uma query" que está lenta.

4. **Causa real, confirmada por evidência de rede + experimento causal:**
   extraindo o trace de rede real do Playwright (`trace.zip` →
   `0-trace.network`), o padrão observado foi uma **rajada de requisições
   concorrentes e DUPLICADAS** logo após o login (`GET /dashboard` ×2,
   `GET /preferences` ×2, `GET /preferences/active-world` ×2,
   `GET /worlds` ×2-3, `GET /rpgs/metadata` ×2), todas competindo pelo
   mesmo processo local `wrangler dev`/Miniflare + arquivo D1 SQLite —
   tempos individuais de 6 a 11 segundos, claramente enfileirados, não
   independentemente lentos.

   As duplicatas vêm de **`<StrictMode>`** (`src/client/main.tsx`) — o
   React intencionalmente monta/desmonta/remonta efeitos duas vezes em
   modo de desenvolvimento (`vite dev`, usado por TODO E2E local e do CI)
   especificamente para achar bugs de efeito não-idempotente. **Isso nunca
   acontece em produção** (build de produção não duplica efeitos) — não é
   um bug de aplicação.

   **Experimento causal, não só correlação:** removendo `<StrictMode>`
   temporariamente e rodando a suíte do zero (frio), o ponto de falha
   **avançou** — a criação de RPG (que falhava 100% das vezes) passou a
   funcionar, e a suíte só falhou mais adiante (criação de World). Isso
   confirma que a duplicação de efeitos do StrictMode é uma causa real e
   mensurável do atraso, mas não a única — mesmo sem ela, esta máquina
   específica ainda tem throughput insuficiente para absorver com folga
   confortável uma rajada de ~5-6 requisições concorrentes dentro de 10s.

   `<StrictMode>` foi mantido no código (é uma proteção de qualidade real
   para desenvolvimento, não algo que deva ser removido só para acomodar
   este computador — o experimento foi revertido depois de confirmar a
   causa).

## Classificação final

**`ENVIRONMENT_LIMITATION`** — throughput de I/O local (worker + D1
simulados via `wrangler dev`/Miniflare, arquivo SQLite local) deste PC
específico, amplificado (não causado) pela duplicação esperada de efeitos
do `<StrictMode>` em modo de desenvolvimento. Não é `PRODUCT_BUG` (backend
correto, comprovado por `curl`; produção real tem concorrência de verdade
e não duplica efeitos), não é `TEST_BUG` genérico de asserção (os
seletores e fluxos estão corretos — comprovado pelo CI verde e pelo
avanço do ponto de falha no experimento causal).

## Mitigação aplicada (não é "aumentar timeout cegamente")

- `tests/e2e/global-setup.ts`: aquece os caminhos de escrita mais pesados
  antes de qualquer teste cronometrado rodar — reduz o atraso real na
  primeira execução de cada caminho, mesmo não eliminando a contenção de
  uma rajada concorrente.
- `expect.timeout` do `playwright.config.ts` **permanece em 10s** — não
  foi alargado cegamente (seção 12 do pedido). Alargar esconderia um bug
  de UI real (spinner genuinamente travado) atrás de um timeout generoso.
- Asserções de rede explícitas (`page.waitForResponse`) substituem
  checagens só de DOM em pontos historicamente sensíveis (remoção de pin),
  para que uma falha futura aponte precisamente para STARTUP/NETWORK vs
  APLICAÇÃO/UI.

## O que NÃO foi feito (e por quê)

- **Não** removido `<StrictMode>` permanentemente — perderia uma proteção
  real de qualidade em desenvolvimento só para acomodar uma máquina.
- **Não** aumentado `expect.timeout` global — esconderia bugs reais de UI.
- **Não** assumido "flake" sem reprodução — cada hipótese acima foi testada
  e descartada ou confirmada com evidência (curl, trace de rede,
  experimento causal com/sem StrictMode).

## Gate de referência

Quando este PC não conseguir rodar a suíte completa com folga confortável:
**CI Linux (`workers:1`) é o navegador automatizado de referência** — não
interrompe o desenvolvimento (ver `CLAUDE.md`, autonomia, e seção 15 do
pedido que originou este documento). O smoke read-only de produção e a
suíte de integração/unit continuam sendo verificados localmente com
confiança total (não dependem de navegador).

## Addendum — RPG-1.0-BATCH5 (F-001): dois bugs reais achados pelo CI, mais uma evidência de degradação transitória de infra

Depois do push inicial do F-001, o CI (referência autoritativa) pegou
dois problemas reais que a suíte local, já classificada como
`ENVIRONMENT_LIMITATION`, não conseguiu diferenciar de ruído — cada um
investigado até causa raiz, nenhum classificado como flake sem evidência
(seção 11/13 do `CLAUDE.md`):

1. **`PRODUCT_BUG` real, pré-existente (não introduzido pelo F-001):**
   `VaultFormPage` e `WorldFormPage` renderizavam o formulário de edição
   imediatamente com valores em branco, e um `useEffect` assíncrono
   sobrescrevia o estado quando o GET do recurso respondia — se o
   usuário digitasse antes da resposta chegar, a digitação era apagada
   silenciosamente. `RpgFormFields` (`library-pages.tsx`) já tinha o gate
   correto (`loading` + fallback); Vault e World não. O novo E2E de
   edição+histórico (rápido e determinístico o bastante) foi o primeiro a
   expor isso de forma confiável. Corrigido com o mesmo padrão de gate.
2. **`TEST_BUG` real, na minha própria suíte nova:** `restore()` do
   `RevisionHistoryModal` chama um `confirm()` nativo (mesmo padrão já
   usado em outros pontos do app) — `revision-history.spec.ts` não
   registrava `page.once('dialog', ...)` antes do clique em
   "Restaurar", então o Playwright descartava o dialog por padrão, o
   restore nunca rodava de verdade, e uma assert seguinte passava por
   falso positivo (casava com o `<h3>` de um preview deixado aberto, já
   que `getByRole('heading', ...)` sem `level` casa qualquer h1–h6).
   Corrigido registrando o handler antes do clique, no mesmo padrão já
   usado corretamente em `release-1.0-smoke.spec.ts` para o pin de
   Cartografia.
3. **Evidência de degradação transitória da infra do CI** (não do
   produto, não do código deste batch): uma rodada intermediária do CI,
   já com os dois fixes acima aplicados, falhou de novo — mas desta vez
   `vault-worlds-flow.spec.ts` (não tocado por nenhum commit deste
   batch, 100% estável em toda a sessão) travou por 90s inteiros num
   `.fill()` trivial, nas duas tentativas, nos dois projects. Isso não é
   compatível com um bug determinístico de código — é o sintoma
   clássico de um runner do GitHub Actions degradado naquele momento.
   Em vez de reescrever testes ou aumentar timeout às cegas para
   acomodar isso, a suíte foi re-executada (`gh run rerun --failed`) —
   passou 100% limpa na rodada seguinte, confirmando a hipótese sem
   mascarar um bug real (se tivesse falhado de novo com o mesmo sintoma
   determinístico, a investigação continuaria).
