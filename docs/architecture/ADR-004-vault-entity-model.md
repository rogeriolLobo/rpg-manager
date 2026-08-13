# ADR-004 — Modelo de entidades do Vault

## Status

Aceito para a V2.0.

## Contexto

Campanhas são execuções temporárias, mas personagens, NPCs, locais, facções, itens, lore, eventos, quests, handouts e Adventures precisam sobreviver e ser reutilizados. A V1 guarda somente snapshots de jogadores/personagens dentro da campanha.

## Alternativas consideradas

1. **Uma tabela por tipo:** oferece constraints específicas, mas duplicaria ownership, World, visibilidade, arquivo, busca e datas em onze CRUDs.
2. **EAV ou documento JSON:** facilitaria adicionar campos, porém reduziria integridade, indexação, validação e segurança contra mass assignment.
3. **Entidade-base com extensões específicas:** concentra campos comuns e cria tabela especializada somente quando existe estrutura própria.

## Decisão

Usar `vault_entities` como entidade-base relacional. Os onze tipos são enum controlado. Campos comuns incluem owner, World e grupo opcionais, nome, resumo, descrição, visibilidade, parent de Location e arquivamento.

`adventure_details` será a única extensão inicial, pois Adventure possui tipo e recomendação de sessões próprios. Location usará `parent_entity_id` na base, aceito somente quando filho e pai forem `LOCATION`; ciclos serão bloqueados no servidor e a FK será restritiva.

Adventure e Campaign permanecerão conceitos separados. Campaign poderá referenciar uma Adventure principal e ligar qualquer entidade por `campaign_entities`, sem cópia.

## Consequências

- busca, filtros, paginação e autorização usam uma fonte comum;
- tipos sem campos próprios não criam tabelas vazias ou JSON arbitrário;
- novos tipos exigem migration, enum, validação, apresentação e testes explícitos;
- fichas de sistema, uploads, mapas, grafo e relações ficam fora da V2.0;
- hard delete será bloqueado quando houver campanhas, Adventure principal ou Location filha dependente;
- arquivamento preserva vínculos e é a operação normal de retirada de uso.
