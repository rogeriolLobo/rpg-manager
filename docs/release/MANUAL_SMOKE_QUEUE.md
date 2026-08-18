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

## Checklist final (preencher ao fechar o 1.0)

- [ ] Todos os itens acima executados sem falha.
- [ ] Nenhuma regressão encontrada em Library/Vault/Worlds/Campaigns
  durante os testes acima (navegação cruzada normal).
- [ ] Light, Dark e System conferidos em pelo menos um dos fluxos acima.
- [ ] Mobile conferido em pelo menos um dos fluxos acima.
