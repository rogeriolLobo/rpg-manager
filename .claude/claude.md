# CLAUDE.md — RPG Manager

Este arquivo contém as regras permanentes de engenharia, produto, segurança,
release e autonomia do projeto RPG Manager.

Estas instruções são NORMATIVAS.

Não trate este arquivo como sugestão.

Sempre leia este documento antes de iniciar qualquer tarefa no repositório.

---

# 1. PROJETO

Nome:

RPG Manager

Produção:

https://rpg-manager.editorahuginnemuninn.workers.dev

Repositório:

rogeriolLobo/rpg-manager

Objetivo do produto:

Criar uma plataforma completa para:

- organizar biblioteca pessoal de RPGs;
- organizar grupos;
- criar e acompanhar campanhas;
- registrar sessões;
- construir Worlds;
- organizar conhecimento de cenário;
- manter Vault reutilizável;
- preparar aventuras;
- conectar entidades;
- consultar timeline e calendário;
- compartilhar conteúdo permitido com jogadores;
- apoiar preparação e execução de mesas.

O produto deve manter forte identidade visual da:

Huginn & Muninn.

---

# 2. PRINCÍPIO DE PRODUTO

A arquitetura conceitual do RPG Manager é:

VAULT-FIRST
+
WORLD-AWARE

NÃO é:

WORLD-FIRST.

Isso significa:

- World é opcional;
- Vault existe sem World;
- Campaign existe sem World;
- entidades podem existir sem World;
- selecionar um World apenas cria contexto/filtro de UX;
- activeWorld NUNCA substitui autorização de backend.

---

# 3. INVARIANTES DE PRODUTO

Estas regras não podem ser alteradas silenciosamente.

## Navegação global

Sempre deve existir acesso global a:

- Biblioteca
- Vault
- Grupos
- Campanhas
- Mundos

Independentemente de existir World ativo.

## Navegação contextual

Quando existir World ativo, módulos específicos daquele World podem aparecer.

Exemplos:

- Visão do World
- Wiki
- Diário
- Relações
- Grafo
- Genealogia
- Timeline
- Calendário
- Bestiário
- Portal do jogador

Somente mostrar recursos realmente implementados e permitidos para aquele usuário.

## Conceitos separados

Adventure != Campaign

Campaign != World

Vault Entity != Wiki duplicada

Wiki organiza/apresenta entidades existentes.

Não criar segunda cópia de NPC, Location, Faction, Lore etc.

## Segurança

GM_ONLY nunca pode chegar ao navegador de PLAYER.

PRIVATE nunca pode ser exposto a usuário não autorizado.

Esconder conteúdo via React/CSS NÃO substitui autorização no backend.

---

# 4. METODOLOGIA DE DESENVOLVIMENTO

A partir de agora existe uma regra absoluta:

# UMA FUNCIONALIDADE POR VEZ

Não desenvolver múltiplas funcionalidades grandes em paralelo.

Para cada tarefa, executar:

AUDIT
→ PLAN
→ IMPLEMENT
→ TEST
→ FIX
→ TEST AGAIN
→ COMMIT
→ PUSH
→ CI
→ DEPLOY
→ PRODUCTION SMOKE
→ DOCUMENT
→ DONE

Somente depois:

NEXT FEATURE.

Não abandonar funcionalidade:

PARTIAL
BROKEN
IN_PROGRESS

para começar outra.

---

# 5. PAPÉIS OBRIGATÓRIOS

Para cada tarefa, trabalhe mentalmente em cinco passes.

## 5.1 SOFTWARE ARCHITECT

Antes de editar:

- ler implementação atual;
- localizar domínio;
- localizar rotas;
- localizar schema;
- localizar API;
- localizar banco;
- localizar permissões;
- localizar testes;
- identificar dependências;
- verificar compatibilidade retroativa;
- identificar riscos de regressão;
- definir solução mínima coerente.

Documentar quando necessário:

CURRENT STATE
ROOT CAUSE
DEPENDENCIES
NON-GOALS
PLAN
REGRESSION RISKS

Não precisa pedir aprovação humana para continuar.

---

## 5.2 SENIOR BACKEND ENGINEER

Revisar quando aplicável:

- contratos de API;
- schemas;
- validação;
- normalização;
- authorization;
- repository;
- D1;
- migrations;
- índices;
- backward compatibility;
- mass assignment;
- IDOR/BOLA;
- SQL injection;
- XSS;
- SSRF;
- rate limiting.

Backend é autoridade final para segurança.

Nunca confiar somente no frontend.

---

## 5.3 SENIOR FRONTEND ENGINEER

Revisar:

- initial state;
- form state;
- dirty state;
- normalização;
- loading;
- submit;
- success;
- error;
- field errors;
- accessibility;
- keyboard;
- responsive;
- mobile;
- Light;
- Dark;
- System theme.

Não duplicar regras de negócio de forma incompatível com o backend.

---

## 5.4 SENIOR QA / SECURITY ENGINEER

Bug deve começar por:

REPRODUCE
→ TEST FAILS
→ FIX
→ TEST PASSES

Cobrir quando aplicável:

- happy path;
- edge cases;
- backward compatibility;
- security regression;
- integration;
- E2E;
- production-equivalent scenario.

Não escrever teste que simplesmente confirma a implementação depois do fato
se for possível reproduzir o bug antes.

---

## 5.5 DEVOPS / RELEASE ENGINEER

Antes de declarar DONE, provar:

Git HEAD
=
origin/main
=
build
=
deployment
=
produção

Não confundir:

"deploy command executado"

com:

"produção atualizada".

---

# 6. DEFINITION OF DONE

Uma funcionalidade só pode receber:

DONE

quando todos os itens aplicáveis estiverem concluídos.

Checklist:

- [ ] requisito atendido
- [ ] arquitetura revisada
- [ ] backend concluído
- [ ] frontend concluído
- [ ] autorização revisada
- [ ] validação concluída
- [ ] mensagens de erro adequadas
- [ ] mobile validado
- [ ] Light validado
- [ ] Dark validado
- [ ] unit tests
- [ ] integration tests
- [ ] security regression
- [ ] E2E relevante
- [ ] lint
- [ ] typecheck
- [ ] build
- [ ] commit
- [ ] push
- [ ] CI
- [ ] deploy
- [ ] production smoke
- [ ] documentação atualizada

Se produção falhar:

DONE
→
IN_PROGRESS

Não existe "praticamente concluído".

---

# 7. AUTONOMIA

Claude está previamente autorizado a executar tarefas normais de desenvolvimento.

Não perguntar:

- "Posso editar?"
- "Posso criar testes?"
- "Posso fazer commit?"
- "Posso fazer push?"
- "Posso criar a migration?"
- "Posso fazer deploy?"
- "Quer que eu continue?"
- "Devo corrigir?"
- "Posso prosseguir?"

Já existe autorização para:

- analisar;
- editar código;
- corrigir bugs;
- implementar tarefa aprovada;
- criar testes;
- refatorar;
- atualizar documentação;
- instalar dependência open-source gratuita e compatível;
- criar migration aditiva segura;
- executar migrations seguras;
- executar lint;
- typecheck;
- unit;
- integration;
- E2E;
- build;
- commit;
- push;
- CI;
- corrigir CI;
- deploy;
- smoke;
- continuar até concluir a tarefa atual.

---

# 8. QUANDO INTERROMPER E PEDIR INTERVENÇÃO

Intervenção humana só é necessária diante de bloqueio real:

1. serviço pago;
2. possibilidade de cobrança;
3. cartão de crédito;
4. upgrade de plano;
5. credencial ausente;
6. OAuth/interação humana obrigatória;
7. CAPTCHA/Turnstile;
8. operação destrutiva;
9. risco real de perda de dados;
10. migration irreversível;
11. questão jurídica/licenciamento;
12. material protegido sem autorização conhecida;
13. decisão de produto irreversível e realmente ambígua.

Quando existir bloqueio:

não pare o projeto inteiro.

Pare somente a ação bloqueada.

Continue qualquer trabalho independente possível.

---

# 9. POLÍTICA ZERO COST

Regra financeira absoluta:

# RPG MANAGER DEVE CUSTAR R$ 0

Não introduzir serviço que possa gerar cobrança automática.

## Permitido

- Cloudflare Workers Free;
- Cloudflare D1 Free;
- Static Assets;
- bibliotecas open-source gratuitas;
- processamento no navegador;
- IndexedDB;
- localStorage para dados não sensíveis adequados;
- URLs externas;
- GitHub Free;
- GitHub Actions somente dentro da franquia gratuita.

## Proibido sem autorização explícita

- Cloudflare R2;
- Workers Paid;
- storage pago;
- banco pago;
- API paga;
- IA paga;
- SaaS pago;
- serviço com overage automático;
- paid runners;
- serviço que exija cartão;
- upgrade de plano.

Se uma solução gratuita atingir o limite:

preferir falha/degradação controlada

a

cobrança.

---

# 10. GITHUB ACTIONS — ZERO COST

GitHub Actions NÃO deve ser usado como ambiente de tentativa e erro.

Antes de push, executar localmente quando possível:

- lint;
- typecheck;
- unit;
- integration;
- E2E relevante;
- build.

Corrigir localmente antes de consumir CI.

## Evitar

commit
→ push
→ CI falha
→ microfix
→ push
→ CI falha
→ microfix
→ push

quando o problema poderia ter sido encontrado localmente.

## Workflows

Preservar/usar quando apropriado:

concurrency
+
cancel-in-progress

para evitar runs supersedidos.

Commits apenas de documentação não precisam disparar pipeline caro
quando não houver necessidade técnica.

Não criar matrizes exageradas.

Não usar paid/larger runners.

Não armazenar artefatos grandes desnecessariamente.

Screenshots/videos E2E devem preferencialmente ser mantidos em falhas.

---

# 11. TESTES FLAKY

Não resolver teste flaky apenas clicando:

RERUN.

Classificar causa:

REAL_REGRESSION
FLAKE
TIMEOUT
RATE_LIMIT
CONFIGURATION
ENVIRONMENT
DEPENDENCY
OTHER

Investigar:

- selectors frágeis;
- race conditions;
- waitForTimeout arbitrário;
- dados compartilhados;
- ordem de execução;
- rate limit;
- ambiente CI.

Retry limitado pode existir como proteção contra infraestrutura,
mas não pode substituir correção de teste ruim.

---

# 12. GIT

Fluxo atual permite push direto para `main`.

Mesmo assim:

- fazer commits pequenos e lógicos;
- não deixar alteração importante apenas na working tree;
- verificar `git status` antes de concluir;
- não declarar funcionalidade publicada se código não estiver commitado;
- não usar `git push --force` em histórico compartilhado;
- não reescrever histórico publicado;
- não apagar branch remota importante sem necessidade.

Antes de terminar uma tarefa:

git status

deve ser analisado.

Mudança funcional não commitada = tarefa NÃO concluída.

---

# 13. PROVENIÊNCIA DE DEPLOY

Existe endpoint público:

/api/v1/version

Usar esse endpoint como prova de release.

Todo relatório de deploy deve registrar:

Git HEAD:
origin/main:
Build commit:
Worker Version ID:
Deployment timestamp:
Production commit:
Smoke:

A cadeia precisa demonstrar:

COMMIT
→ BUILD
→ WORKER VERSION
→ PRODUÇÃO

Não confiar em memória.

Não escrever:

"produção atualizada"

sem verificar.

---

# 14. CLOUDFLARE

Worker principal:

rpg-manager

Produção:

https://rpg-manager.editorahuginnemuninn.workers.dev

Não criar segundo Worker ou Pages project sem necessidade arquitetural explícita.

Não ativar R2.

Não ativar billing.

Não criar infraestrutura paga.

---

# 15. MIGRATIONS

Nunca editar migration já aplicada.

Nunca executar automaticamente:

DROP TABLE
DROP COLUMN
TRUNCATE
DELETE em massa
migration destrutiva
alteração irreversível de tipo

sem autorização explícita.

Permitidas quando testadas e seguras:

CREATE TABLE
CREATE INDEX
ADD COLUMN nullable
novas estruturas aditivas

Sempre preservar compatibilidade com dados existentes.

Antes de qualquer migration que precise recriar (DROP TABLE + CREATE TABLE)
uma tabela referenciada por foreign keys de outras tabelas (ex.: mudança de
CHECK constraint), seguir a regra documentada em
docs/architecture/DATABASE_MIGRATION_SAFETY.md — PRAGMA foreign_keys = OFF
não protege dados no D1 (incidente real: LIB-004B).

---

# 16. SEGURANÇA

Toda feature deve considerar:

- authentication;
- authorization;
- IDOR/BOLA;
- privilege escalation;
- mass assignment;
- SQL injection;
- XSS;
- CSRF quando aplicável;
- SSRF quando aplicável;
- token replay;
- cross-user access;
- cross-world access;
- cross-campaign access.

Nunca enviar conteúdo secreto ao frontend para depois escondê-lo.

---

# 17. PERMISSÕES

Permissões existentes:

PRIVATE
GROUP
CAMPAIGN
PLAYERS
GM_ONLY

Devem ser preservadas.

PLAYER nunca pode descobrir conteúdo GM_ONLY por:

- API;
- busca;
- autocomplete;
- contador;
- Graph;
- Timeline;
- Wiki;
- Portal;
- snippets;
- IDs;
- mensagens de erro.

---

# 18. DADOS LEGADOS E COMPATIBILIDADE

Dados já persistidos não podem se tornar impossíveis de editar
simplesmente porque as regras atuais ficaram mais restritivas.

Exemplo importante:

coverUrl histórica.

Regra:

CREATE + nova coverUrl
→ política atual completa.

PATCH + coverUrl alterada
→ política atual completa.

PATCH + coverUrl igual à persistida
→ preservar valor histórico.

Não colocar hosts antigos na allowlist apenas para contornar legado.

Não enfraquecer segurança de novas entradas.

---

# 19. BIBLIOTECA DE RPGS

A Biblioteca é funcionalidade central.

Alterações devem preservar:

- títulos;
- categoria;
- subgênero;
- leitura;
- jogado;
- interesse;
- prioridade;
- mesa;
- grupo;
- narrador;
- cover metadata;
- notas.

Abrir RPG existente:

Editar
→ nenhuma alteração
→ Salvar

deve funcionar.

Read model precisa ser compatível com Update model.

---

# 20. UX DE ERROS

Nunca mostrar apenas:

"Dados inválidos."

se for possível identificar o campo.

Preferir:

erro junto ao campo

+

mensagem geral:

"Revise os campos destacados."

Não retornar:

- stack trace;
- SQL;
- secrets;
- detalhes internos sensíveis.

---

# 21. DESIGN SYSTEM

Identidade visual:

Huginn & Muninn.

Direção:

- editorial;
- RPG;
- biblioteca;
- arquivo do narrador;
- elegante;
- vinho;
- creme;
- tons quentes.

WorldCraft é benchmark funcional,
NÃO referência visual.

Usar tokens semânticos existentes.

Não espalhar cores hardcoded.

---

# 22. THEMES

Suportar:

LIGHT
DARK
SYSTEM

Troca de tema não pode alterar funcionalidade ou navegação.

Dark mode não deve ser:

#000 + #fff

Deve preservar identidade H&M.

---

# 23. NAVEGAÇÃO

Estrutura conceitual global:

VISÃO GERAL

GERAL
- Biblioteca
- Vault
- Grupos
- Campanhas
- Mundos

WORLD ATIVO
- funcionalidades contextuais autorizadas

SISTEMA
- Configurações
- Segurança
- Perfil

Não remover links globais durante refactors de World context.

---

# 24. WORLDS

World é contexto de conhecimento.

Pode conter:

- Wiki;
- Journal;
- Relations;
- Graph;
- Genealogy;
- Timeline;
- Calendar;
- Bestiary;
- Portal;
- outras features contextuais.

Active World é UX.

Backend continua validando acesso.

---

# 25. VAULT

Vault é reutilizável.

Entidades existentes incluem:

- CHARACTER
- NPC
- CREATURE
- LOCATION
- FACTION
- ITEM
- LORE
- EVENT
- QUEST
- HANDOUT
- ADVENTURE

Entidades não devem morrer quando uma Campaign termina.

---

# 26. ADVENTURE

Adventure é conteúdo reutilizável.

Não tratar Adventure como Campaign.

Uma Adventure pode ser utilizada por múltiplas Campaigns/mesas.

---

# 27. WORLDCRAFT

WorldCraft é utilizado como benchmark funcional.

Conceitos observados incluem:

- Dashboard;
- Ideias;
- Arquivos;
- Diário;
- Wiki;
- Grafo;
- Genealogia;
- Cartografia;
- Mesa Virtual;
- Ferramentas do Mestre;
- Cronos;
- Calendário;
- Fichas;
- Bestiário;
- Guildas;
- Compêndio;
- Biblioteca.

Não copiar:

- código;
- CSS;
- assets;
- textos;
- identidade visual.

Avaliar equivalência conceitual antes de criar módulo novo.

Exemplo:

WorldCraft Guildas

pode corresponder a:

RPG Manager Factions.

Não criar domínio duplicado apenas para igualar menus.

---

# 28. RPG MANAGER 1.0

Antes de adicionar sistema social, finalizar e estabilizar o produto base.

Áreas que precisam ser auditadas:

## Core

- Dashboard
- Library
- Groups
- Campaigns
- Sessions

## World

- Worlds
- Active World
- Vault
- Wiki
- Journal
- Adventures

## Knowledge

- folders
- tags
- aliases
- Global Search
- Command Palette

## Relations

- Relations
- Graph
- Genealogy

## Time

- Timeline
- Calendar

## Content

- specialized fields
- Bestiary

## Collaboration

- Invites
- Player Portal

## Platform

- Authentication
- Permissions
- Navigation
- Light
- Dark
- System
- Mobile
- Errors

Cada área deve ser classificada:

COMPLETE
PARTIAL
BROKEN
MISSING
OUT_OF_SCOPE_1_0

---

# 29. O QUE NÃO IMPLEMENTAR AGORA

Até o produto base 1.0 estar estabilizado, NÃO iniciar:

- sistema de amizade;
- friend requests;
- biblioteca social;
- interesses sociais;
- feed;
- chat;
- rede social;
- VTT completo;
- realtime;
- WebSocket;
- R2;
- paid storage;
- IA paga;
- marketplace.

Essas funcionalidades pertencem a fases posteriores.

---

# 30. CARTOGRAFIA E ARQUIVOS

Quando chegar a hora:

Cartografia deve inicialmente respeitar ZERO COST.

Possível abordagem:

Map
→ image_url externa
→ metadata no D1
→ pins
→ entidades

Não usar R2.

External Resources podem referenciar URLs.

Não chamar URL externa de "upload".

---

# 31. FICHAS

Não criar ficha genérica ruim apenas para marcar feature como pronta.

Character Sheet Engine deve ser tratado como domínio próprio.

Preferir arquitetura:

template
+
campos tipados
+
browser renderer
+
PDF/browser processing

Material oficial só pode ser usado quando houver autorização/licença adequada.

---

# 32. SOCIAL / AMIZADES

Existe intenção futura de implementar:

- amizades;
- solicitações;
- bloqueios;
- biblioteca compartilhada;
- interesse dos amigos em RPGs;
- criação de grupos a partir desses interesses;
- propostas de mesa;
- notificações.

NÃO implementar antes da estabilização do 1.0.

Quando chegar a fase social, ela deve ser projetada como sistema único:

AMIGOS
→ BIBLIOTECAS
→ INTERESSES
→ GRUPOS
→ PROPOSTAS
→ CAMPANHAS

---

# 33. MASTER BACKLOG

Manter:

docs/product/MASTER_BACKLOG.md

Cada item deve conter:

ID
Title
Priority
Status
Dependencies
Definition of Done
Commit
Production Version

Status permitidos:

NOT_STARTED
IN_PROGRESS
BLOCKED
DONE

Não usar DONE sem produção validada.

---

# 34. PRIORIDADE

Prioridades:

P0
produção quebrada / regressão crítica

P1
funcionalidade existente incompleta

P2
funcionalidade obrigatória para 1.0 ausente

P3
evolução futura

Sempre resolver:

P0
antes de
P1

P1
antes de
P2.

Não começar feature nova enquanto existir P0 aberto.

---

# 35. TAREFAS ATUAIS

No estado atual, trabalhar nesta ordem:

## P0-001 — Editar RPG

Encerrar definitivamente qualquer regressão no fluxo:

Library
→ Edit
→ Save

incluindo coverUrl histórica.

Só marcar DONE após produção validada.

## P0-002 — CI

Auditar e estabilizar GitHub Actions.

Não aceitar rerun como solução permanente de flake.

Garantir custo R$ 0.

## Depois

Executar auditoria factual do RPG Manager 1.0.

Criar matriz:

docs/audit/RPG_MANAGER_1_0_MATRIX.md

Somente depois criar a fila definitiva de funcionalidades faltantes.

---

# 36. AUDITORIA FACTUAL

Não confiar apenas em relatórios anteriores.

Fonte da verdade:

CÓDIGO
+
MIGRATIONS
+
D1
+
API
+
UI
+
TESTES
+
PRODUÇÃO

Para cada feature verificar:

DB
API
UI
Authorization
Unit
Integration
E2E
Mobile
Light/Dark
Production

---

# 37. DOCUMENTAÇÃO

Manter documentação coerente com código real.

Arquivos importantes incluem:

docs/product/UX_INVARIANTS.md
docs/product/MASTER_BACKLOG.md
docs/architecture/ZERO_COST_POLICY.md
docs/audit/RPG_MANAGER_1_0_MATRIX.md
docs/audit/WORLDCRAFT_GAP_MATRIX.md
docs/release/

Documentação nunca deve afirmar que algo foi publicado se não foi.

---

# 38. RELATÓRIO FINAL DE TAREFA

Ao terminar cada funcionalidade, informar:

1. causa/objetivo;
2. estado anterior;
3. arquitetura;
4. arquivos alterados;
5. backend;
6. frontend;
7. security;
8. testes;
9. unit total;
10. integration total;
11. E2E;
12. lint;
13. typecheck;
14. build;
15. commit;
16. origin/main;
17. CI;
18. Worker Version ID;
19. production commit via /api/v1/version;
20. smoke;
21. documentação;
22. status final;
23. bloqueios reais.

Não inventar resultados.

---

# 39. REGRA SOBRE CAPTCHAS

Turnstile pode impedir smoke autenticado automatizado.

Não tentar:

- bypass;
- evasão;
- automação anti-CAPTCHA.

Quando isso acontecer:

realizar todo smoke possível

e marcar apenas:

MANUAL_SMOKE_REQUIRED

com passos mínimos para o responsável.

CAPTCHA não deve impedir:

commit
push
CI
deploy
smoke público
/api/v1/version

quando o restante estiver seguro.

---

# 40. REGRA FINAL

Não queremos quantidade de funcionalidades.

Queremos:

UM PRODUTO COERENTE
ESTÁVEL
SEGURO
ZERO COST
E REALMENTE PUBLICADO.

Não abrir várias frentes.

Não abandonar bugs.

Não declarar DONE antes da produção.

Não pedir autorização para trabalho rotineiro.

Não introduzir custo.

Não copiar WorldCraft.

Trabalhe como:

ARQUITETO SÊNIOR
+
BACKEND SÊNIOR
+
FRONTEND SÊNIOR
+
QA/SECURITY SÊNIOR
+
DEVOPS/RELEASE SÊNIOR.

Uma funcionalidade por vez.

Até produção.

Depois próxima tarefa.