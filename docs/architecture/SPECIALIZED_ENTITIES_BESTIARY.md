# Campos especializados e Bestiário

## Decisão

Os campos universais de Character, NPC, Creature, Faction e Item vivem em extensões relacionais 1:1 de `vault_entities`. O modelo mantém identidade, visibilidade, World, campanha, relações e ciclo de vida na entidade-base; detalhes por tipo não são EAV.

## Fichas de criatura

Uma ficha estruturada usa duas camadas:

1. `creature_stat_templates` define, por World, uma lista validada de campos `TEXT`, `NUMBER` ou `BOOLEAN`;
2. `creature_stat_blocks` associa uma criatura a um modelo e persiste somente os valores das chaves declaradas.

O servidor rejeita chaves desconhecidas, tipos divergentes, campos obrigatórios ausentes, modelo de outro World e modelo de outro owner. HP, CA, Força ou qualquer atributo de sistema não existem no schema central.

## Segurança

`gm_notes` de NPC, Faction e Item é selecionado no servidor, mas só entra no objeto de resposta quando `resolveEntityVisibility` resulta em `OWNER` ou `GAME_MASTER`. Para Player e demais leitores autorizados a propriedade não é serializada. A UI não participa dessa decisão.

## Limites deliberados

- um bloco de estatísticas por criatura nesta versão;
- modelos pertencem a um único World;
- remoção de modelo em uso é bloqueada;
- não há marketplace, compartilhamento público de modelos ou importador de fichas;
- tags continuam no vocabulário já existente da Wiki, sem duplicação no Bestiário.
