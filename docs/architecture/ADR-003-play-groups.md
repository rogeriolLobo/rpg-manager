# ADR-003 — Grupos de jogo reutilizáveis

## Status

Aceito.

## Contexto

A planilha guardava `Grupo / Jogadores` como texto em RPGs e campanhas. Esse formato é útil para migração, mas não permite reutilizar o mesmo grupo, editar jogadores uma vez ou associar personagens e presença com segurança.

## Decisão

`play_groups` pertence a um usuário e contém `play_group_members`. RPGs e campanhas podem apontar opcionalmente para um grupo; o mesmo grupo pode ser usado por vários registros. Ao vincular um grupo a uma campanha, seus membros ativos são copiados para `campaign_members` com referência ao membro de origem. A campanha continua sendo dona do personagem, notas e presença daquele elenco.

Os campos de texto legado permanecem disponíveis. Importações nunca separam automaticamente nomes ou personagens ambíguos.

## Consequências

- alterar nome/estado de um membro do grupo sincroniza os elencos originados dele;
- remover membro ou grupo não remove RPG, campanha nem histórico; as FKs usam `SET NULL` onde necessário;
- trocar o grupo da campanha adiciona os novos membros sem apagar o elenco anterior;
- duplicatas são impedidas por grupo e pela referência de origem dentro da campanha;
- ajustes específicos de personagem continuam locais à campanha.

## Trade-off

A cópia controlada evita acoplar o histórico da campanha a alterações futuras no grupo. Em contrapartida, jogadores removidos do grupo permanecem na campanha para preservar sessões e presença já registradas.
