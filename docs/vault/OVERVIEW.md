# Vault V2.0

Vault é a visão de todas as entidades que a conta possui ou pode acessar; não é um container obrigatório. Uma entidade pode ter `world_id=NULL`, nenhuma campanha ou várias campanhas.

## Tipos e extensões

A base comum suporta Character, NPC, Creature, Location, Faction, Item, Lore, Event, Quest, Handout e Adventure. Somente Adventure usa extensão estruturada nesta versão (`adventure_details`). Location pode apontar para outra Location do mesmo World; a API rejeita pai de outro tipo, World divergente e ciclos.

Para adicionar um tipo futuro: inclua o enum em migration append-only, atualize `ENTITY_TYPES`, validação/labels e testes. Crie extensão relacional somente quando houver campos realmente estruturados; não introduza EAV ou JSON arbitrário.

## Ciclo de vida

Arquivar preserva vínculos e histórico, remove o conteúdo das listagens compartilhadas e mantém acesso do owner. Hard delete é permitido apenas sem campanha, Adventure principal ou filha Location. Encerrar/excluir campanha remove a relação da campanha, nunca a entidade do Vault.

## Fora da V2.0

Não foram implementados: ficha específica por sistema, stat blocks, grafo de relações, mapas, timeline, conteúdo público, colaboração de edição, R2/uploads, PDF, integração com planilhas, marketplace, discovery, realtime ou IA. Esses itens permanecem para V2.1+.
