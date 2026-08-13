# Checkpoint autônomo — Fase D

Data: 2026-08-13

## Entregas

- detalhes temporais para entidades EVENT existentes;
- data histórica textual, chave de ordenação, era e precisão;
- eras configuráveis e ordenáveis por World;
- calendário fictício com meses, dias da semana, ciclos e feriados;
- anos negativos e meses de tamanho variável;
- Timeline visual permission-aware com busca e filtros;
- entidades relacionadas somente por relações explícitas autorizadas;
- criação de EVENT pré-configurada a partir da Timeline;
- separação preservada entre data ficcional e data real da sessão.

## Migration

- `0014_world_timeline_calendar.sql`;
- aditiva, sem alteração de tabelas existentes;
- aplicação local e `PRAGMA foreign_key_check`: aprovados;
- backup lógico remoto pré-migration: `rpg-manager-d1-pre-0014-20260813.sql`;
- SHA-256 do backup: `5C47D71F3A0C7415BF0FA81135DFB49BC664516CC6C73659D21B7448C6778B67`;
- aplicação remota e `PRAGMA foreign_key_check`: aprovados;
- nenhuma migration pendente.

## Segurança

- EVENT, era e calendário precisam pertencer ao mesmo World;
- mutação exclusiva do owner;
- leitura usa o predicado de autorização do Vault;
- dias e meses validados no servidor;
- alteração que invalida datas existentes retorna conflito;
- sem inferência de relações ou datas.

## Validação até o checkpoint

- unitários: 56 aprovados;
- integração: 28 aprovados;
- E2E da Timeline: aprovado em desktop e mobile;
- lint, typecheck e build: aprovados.

## Commits

- `d1592b3` — modelo, migration, API e regressão de segurança;
- `1844e06` — workspace Timeline/Calendar e E2E.

## Deploy e smoke

- PR: `#5`;
- merge na `main`: `7994cd9`;
- CI da `main`: aprovado no run `31749871400`;
- Worker publicado: `aebbf20d-9c11-496a-a1be-3681f9d39041`;
- `/app` e assets: HTTP 200 com CSP e `nosniff`;
- endpoint da Timeline sem autenticação: HTTP 401;
- smoke autenticado: sessão preservada, dashboard carregado e dados existentes íntegros;
- a conta usada no smoke não possui World, portanto nenhum dado fictício foi criado apenas para testar a interface.

## Limitações deliberadas

- não há conversão automática entre calendários;
- `sort_key` é uma decisão autoral, não uma data universal;
- posições e escalas visuais não são persistidas;
- não há NLP/IA para inferir cronologia.

## Resultado

Fase D concluída e publicada. Próximo passo: campos especializados e Bestiário sem hardcode de sistema.
