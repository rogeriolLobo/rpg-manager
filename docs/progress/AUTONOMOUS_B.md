# Checkpoint autônomo — Fase B

Data: 2026-08-13

## Entregas verificadas

- World ativo persistente como preferência de UX, validado pelo backend;
- dashboard de World com conteúdo autorizado e atalhos;
- Wiki sobre as mesmas entidades do Vault, com pastas, tags, aliases e backlinks editoriais;
- Lore e Adventure especializadas sem duplicar entidades;
- Diário privado do narrador;
- busca global permission-aware e Command Palette por teclado;
- convites com segredo aleatório, hash persistido, expiração, limite de usos e revogação;
- retorno ao convite após login/cadastro e aceite idempotente;
- portal de jogador usando a mesma política de autorização do Vault.

## Migrations

- `0010_active_world_and_wiki.sql`;
- `0011_lore_adventure_and_journal.sql`;
- `0012_world_invites.sql`.

As migrations são aditivas, estão aplicadas no D1 remoto e `wrangler d1 migrations list DB --remote` não aponta pendências.

## Segurança

- resultados de Wiki, aliases, backlinks, busca e portal são filtrados no servidor;
- `GM_ONLY` não é enviado a jogadores sem papel de narrador;
- Diário e organização editorial permanecem exclusivos do proprietário;
- World ativo não concede autorização;
- convites não persistem o token em texto puro.

## Validação repetida nesta execução

- lint: aprovado;
- typecheck: aprovado;
- unitários: 51 aprovados;
- integração: 24 aprovados;
- E2E: 4 aprovados, desktop e mobile;
- build: aprovado;
- CI remoto no commit `ae58814`: aprovado.

## Commit, deploy e smoke

- commit consolidado da V2.1: `ae58814`;
- versão Worker: `ae73f6e3-0a63-4434-a7a4-0afde92f540d`;
- produção: `https://rpg-manager.editorahuginnemuninn.workers.dev/app`;
- smoke público e autenticado concluído.

## Riscos e limitações

- backlinks derivam apenas da sintaxe editorial `[[nome ou alias]]`;
- o portal é deliberadamente read-only;
- relações semânticas, grafo e genealogia pertencem à Fase C.

## Próximo passo

Introduzir `entity_relations` de modo aditivo e aplicar a autorização às duas pontas antes de construir qualquer visualização.
