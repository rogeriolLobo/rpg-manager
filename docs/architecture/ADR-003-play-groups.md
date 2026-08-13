# ADR-003 — Grupos de jogo reutilizáveis

## Status

Aceito.

## Contexto

A planilha guardava `Grupo / Jogadores` como texto em RPGs e campanhas. Esse formato é útil para migração, mas não permite reutilizar o mesmo grupo, editar jogadores uma vez ou associar personagens e presença com segurança.

## Decisão

`play_groups` pertence a um usuário e contém `play_group_members`. RPGs e campanhas podem apontar opcionalmente para um grupo; o mesmo grupo pode ser usado por vários registros. Ao vincular um grupo a uma campanha, seus membros ativos são copiados para `campaign_members` com referência ao membro de origem. A campanha continua sendo dona do personagem, notas e presença daquele elenco.

Um membro pode ser um convidado identificado somente por nome ou uma conta cadastrada vinculada por `user_id`. A busca de contas é autenticada, exige ao menos três caracteres, retorna no máximo oito resultados e expõe somente UUID e nome público. A consulta aceita trecho do nome público ou correspondência exata com um e-mail já conhecido; e-mail, estado da conta e demais atributos nunca fazem parte da resposta.

Um grupo pode ter no máximo um narrador principal. A restrição é garantida por índice parcial no banco, e selecionar outro narrador rebaixa o anterior. Ao criar uma campanha com o campo de narrador vazio, o nome do narrador do grupo é usado como valor inicial; alterações posteriores na campanha continuam independentes.

Os campos de texto legado permanecem disponíveis. Importações nunca separam automaticamente nomes ou personagens ambíguos.

## Consequências

- alterar nome/estado de um membro do grupo sincroniza os elencos originados dele;
- remover membro ou grupo não remove RPG, campanha nem histórico; as FKs usam `SET NULL` onde necessário;
- trocar o grupo da campanha adiciona os novos membros sem apagar o elenco anterior;
- duplicatas são impedidas por grupo e pela referência de origem dentro da campanha;
- ajustes específicos de personagem continuam locais à campanha.
- a troca do nome público de uma conta sincroniza os nomes vinculados, preservando as referências;
- a exclusão da conta aplica `SET NULL` e mantém o nome como snapshot histórico;
- contas cadastradas não podem ter seus nomes públicos forjados pelo proprietário do grupo.

## Trade-off

A cópia controlada evita acoplar o histórico da campanha a alterações futuras no grupo. Em contrapartida, jogadores removidos do grupo permanecem na campanha para preservar sessões e presença já registradas.

A descoberta por nome público facilita formar mesas, mas permite inferir que um nome está cadastrado. A mitigação aceita para esta versão é autenticação obrigatória, busca mínima, limite de resultados e rate limit por conta. Um controle de visibilidade opt-in pode ser adicionado futuramente se o produto precisar de perfis privados.
