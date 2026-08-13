# Vault V2.0

Vault é a visão de todas as entidades que a conta possui ou pode acessar; não é um container obrigatório. Uma entidade pode ter `world_id=NULL`, nenhuma campanha ou várias campanhas.

## Tipos e extensões

A base comum suporta Character, NPC, Creature, Location, Faction, Item, Lore, Event, Quest, Handout e Adventure. Character, NPC, Creature, Faction, Item, Lore e Adventure possuem extensões relacionais estruturadas. Location pode apontar para outra Location do mesmo World; a API rejeita pai de outro tipo, World divergente e ciclos.

Para adicionar um tipo futuro: inclua o enum em migration append-only, atualize `ENTITY_TYPES`, validação/labels e testes. Crie extensão relacional somente quando houver campos realmente estruturados; não introduza EAV ou JSON arbitrário.

## Ciclo de vida

Arquivar preserva vínculos e histórico, remove o conteúdo das listagens compartilhadas e mantém acesso do owner. Hard delete é permitido apenas sem campanha, Adventure principal ou filha Location. Encerrar/excluir campanha remove a relação da campanha, nunca a entidade do Vault.

## Bestiário

Criaturas têm campos universais e podem receber um bloco de estatísticas definido por modelo do World. O núcleo não contém atributos de um RPG específico. Tags continuam compartilhadas com a Wiki.

## Fora do escopo atual

Não foram implementados mapas, conteúdo público, colaboração de edição, R2/uploads, PDF, marketplace, discovery, realtime ou IA.
