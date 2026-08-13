# Checkpoint autônomo — Fase E

Data: 2026-08-13

## Entregas

- Character: conta de jogador opcional, pronomes, conceito, status e notas;
- NPC: papel, ocupação, motivação, notas públicas e notas do narrador;
- Creature: classificação, habitat, comportamento e notas de perigo;
- Faction: propósito, escopo, status, descrição pública e notas do narrador;
- Item: tipo, raridade textual, descrição pública e notas do narrador;
- Bestiário por World com listagem de criaturas e modelos de estatísticas;
- modelos livres de sistema com campos texto, número e sim/não;
- edição e visualização responsivas dentro do Vault.

## Migration

- `0015_specialized_entities_bestiary.sql`;
- aditiva e sem alteração de dados existentes;
- oito tabelas novas, todas subordinadas a entidades ou Worlds existentes;
- aplicação local e `PRAGMA foreign_key_check`: aprovados.

## Segurança

- mutações de detalhes e modelos são exclusivas do owner;
- `gmNotes` de NPC, Faction e Item não é serializado para Player;
- regressão de integração comprova owner/GM/Player;
- modelo e criatura precisam pertencer ao mesmo World e owner;
- chaves e tipos do bloco são validados no servidor;
- exclusão de modelo em uso retorna conflito.

## Validação até o checkpoint

- unitários: 58 aprovados;
- integração: 30 aprovados;
- E2E do Bestiário: aprovado em desktop e mobile;
- lint, typecheck e build: aprovados.

## Commits

- `7ce1e2c` — migration, domínio, API, autorização e testes;
- `08b66e3` — editores especializados, workspace e E2E.

## Deploy e smoke

Pendentes do push, CI remoto, backup lógico e migration remota segura.

## Próximo passo

Após publicação segura, registrar as decisões arquiteturais da Fase F sem implementar funcionalidades futuras.
