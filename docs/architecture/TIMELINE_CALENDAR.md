# Timeline e Calendar — decisão arquitetural

Status: aceita

Data: 2026-08-13

## Contexto

EVENT já é uma entidade reutilizável do Vault. A cronologia precisa ordenar eventos de mundos que podem não possuir anos, meses ou eras gregorianas, sem confundir a data ficcional com a data real em que uma sessão foi jogada.

## Decisão

- `vault_entities` continua sendo a identidade do EVENT;
- `event_temporal_details` é uma extensão 1:1 opcional;
- `sort_key` inteiro define somente ordem relativa e não é timestamp;
- `historical_date` e `display_text` preservam a linguagem do cenário;
- `world_eras` fornece períodos ordenáveis;
- `world_calendars` armazena uma definição estruturada e validada de meses, semana, ciclos e feriados;
- a data de calendário do EVENT guarda ano, índice de mês e dia;
- alterações de calendário são rejeitadas quando invalidariam datas em uso;
- relações exibidas pela Timeline são consumidas da API V2.2, já autorizada.

## Alternativas descartadas

- converter tudo para ISO/Gregoriano: não representa muitos cenários;
- EAV para calendários: complexidade e validação desproporcionais;
- duplicar EVENTs em uma tabela de Timeline: quebraria a identidade do Vault;
- inferir entidades relacionadas pelo texto: criaria informação não explícita e risco de vazamento.

## Consequências

O calendário é flexível sem tornar cada campo da aplicação dinâmico. A posição visual pode evoluir sem migrar dados. Não existem cálculos automáticos de data absoluta entre calendários diferentes; a ordenação autoral usa `sort_key`.
