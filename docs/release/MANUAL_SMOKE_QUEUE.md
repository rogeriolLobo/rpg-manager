# Fila de Manual Smoke — RPG Manager 1.0

Este arquivo existe porque produção usa Turnstile no login/registro, o
que impede automação de ponta-a-ponta autenticada contra produção real.
Todo smoke automatizável (build, versão, contagem de linhas, rotas
públicas respondendo, migrations aplicadas) já foi executado e
registrado nos relatórios de cada batch. O que resta aqui é
especificamente o que só um humano pode validar em produção real.

Regra (ver `.claude/CLAUDE.md`, Seção 39): CAPTCHA não bloqueia commit,
push, CI, deploy ou smoke público — só bloqueia o smoke autenticado.
Por isso o desenvolvimento não parou esperando esta fila ser executada.

## Como usar

Executar em produção (https://rpg-manager.editorahuginnemuninn.workers.dev)
logado com uma conta real, uma vez por item. Marcar `[x]` e anotar data
+ resultado. Se algo falhar, é regressão real — reabrir o item no
`MASTER_BACKLOG.md` como P0/P1 conforme o impacto.

## Status: AUTOMATED = PASS (equivalente local) / BLOCKED_BY_TURNSTILE (produção autenticada)

Tentativa de automação total documentada na sessão de teste final
autônomo: sem sessão de produção legítima reutilizável disponível no
ambiente de execução (sem storageState, sem perfil de navegador salvo,
sem cookie em variável de ambiente) — os 5 itens abaixo **não** puderam
ser automatizados contra produção real (Turnstile bloqueia
login/registro automatizado, e burlar isso é proibido). Continuam
exigindo a execução humana marcada abaixo.

O que FOI feito: `tests/e2e/release-1.0-smoke.spec.ts` prova
automaticamente, em ambiente local equivalente (mesma build, mesmo
código), que os 5 fluxos funcionam corretamente ponta-a-ponta — desktop
e mobile, com captura de console/network (falha se aparecer erro real
de aplicação). Isso reduz o risco do smoke humano a apenas confirmar
que produção real (dados/infra reais) se comporta igual ao ambiente
local já provado — não elimina a necessidade da execução abaixo.

## RPG-1.0-BATCH2

- [ ] **Ideas / Quick Capture** — no Dashboard, clicar "Nova ideia",
  escolher um World próprio, salvar, confirmar que aparece no Diário
  daquele World.
- [ ] **External Resources** — abrir um World próprio → "Recursos
  externos" → adicionar um link (título+URL+tipo), confirmar que
  aparece na lista, remover.
- [ ] **Global Search** — usar a busca global (Command Palette) e
  confirmar que resultados respeitam o World ativo e não vazam
  conteúdo de outro usuário.

## RPG-1.0-BATCH3

- [ ] **Cartografia** — abrir um World próprio → "Cartografia" →
  adicionar um mapa (URL de imagem pública) → abrir o mapa → adicionar
  um pin (clicando na imagem para preencher X/Y) → confirmar que o pin
  aparece na posição certa → vincular um pin a uma entidade do Vault →
  remover o pin.
- [ ] **GM Tools** — abrir "Ferramentas do Mestre" (menu Sistema) →
  rolar um dado (ex.: `2d6+1`) e conferir o resultado → iniciar/pausar/
  zerar o timer.

## RPG-1.0-BATCH5 (F-001 — Revision History)

- [ ] **Vault → Histórico** — abrir uma entidade própria do Vault,
  editar e salvar, clicar em "Histórico", confirmar que aparecem 2
  revisões (Criação + Edição), abrir "Ver" na revisão antiga, restaurar
  e confirmar que o conteúdo voltou e uma 3ª revisão (Restauração)
  apareceu no topo.
- [ ] **World → Histórico** — mesmo fluxo acima, mas na tela de detalhe
  de um World próprio.
- [ ] **Journal → Histórico** — abrir uma página do Diário de um World
  próprio, editar, salvar, confirmar histórico e restore funcionam
  igual.
- [ ] **Isolamento** — confirmar que o botão "Histórico" não aparece em
  entidades/Worlds que não são seus (visão de PLAYER/campanha).

## Checklist final (preencher ao fechar o 1.0)

- [ ] Todos os itens acima executados sem falha.
- [ ] Nenhuma regressão encontrada em Library/Vault/Worlds/Campaigns
  durante os testes acima (navegação cruzada normal).
- [ ] Light, Dark e System conferidos em pelo menos um dos fluxos acima.
- [ ] Mobile conferido em pelo menos um dos fluxos acima.
