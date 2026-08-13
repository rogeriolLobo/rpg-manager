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
- aplicação local e `PRAGMA foreign_key_check`: aprovados;
- backup lógico remoto pré-migration: `rpg-manager-d1-pre-0015-20260813.sql`;
- SHA-256 do backup: `A467A27A50E48731561AAFF38289C777E366ABD09F0676662F599D97ECCE7149`;
- aplicação remota e `PRAGMA foreign_key_check`: aprovados;
- nenhuma migration pendente.

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

- PR: `#6`;
- merge na `main`: `c3f2b7f`;
- CI da PR e CI da `main` (`31752267813`): aprovados;
- Worker publicado: `995f4d9b-e269-4a64-aa32-31b657d428db`;
- `/app` e novo bundle: HTTP 200 com CSP e `nosniff`;
- APIs de Vault e Bestiário sem autenticação: HTTP 401;
- smoke autenticado: sessão e dashboard carregados, 27 RPGs existentes preservados;
- nenhum World ou conteúdo fictício foi criado em produção para o smoke.

## Resultado

Fase E concluída e publicada. Próximo passo: registrar as decisões arquiteturais da Fase F sem ativar infraestrutura remota.
