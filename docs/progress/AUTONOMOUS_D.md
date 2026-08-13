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
- aplicação remota: pendente do CI.

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

Pendentes do push, CI remoto, backup lógico e migration remota segura.

## Limitações deliberadas

- não há conversão automática entre calendários;
- `sort_key` é uma decisão autoral, não uma data universal;
- posições e escalas visuais não são persistidas;
- não há NLP/IA para inferir cronologia.

## Próximo passo

Após publicação segura, iniciar campos especializados e Bestiário sem hardcode de sistema.
